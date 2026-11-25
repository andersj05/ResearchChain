"""Explicit recovery preserves the exact swarm, completed receipts, and owner judgment."""

import asyncio
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import UUID, uuid4

import pytest
from access_fixtures import owner_client
from test_research_swarm import SwarmProvider, consult, delegate, finish, packets, setup

from researchchain.dispatch import RunQueue
from researchchain.main import create_app
from researchchain.models import ResumeRequest
from researchchain.providers.chatgpt_auth import GENERIC_PROVIDER_ERROR, error_for_code
from researchchain.providers.credentials import ConnectionError
from researchchain.revisions import ConflictError
from researchchain.worker import RunWorker


class FailingWorker(SwarmProvider):
    def __init__(self, *failures, consultation=False):
        self.failures = failures
        self.first_finished = Event()
        self.worker_calls = Counter()
        self.consultation = consultation
        super().__init__(self.actions)

    def actions(self, status):
        turn = status["turn"]
        if self.consultation and turn == 1:
            return consult()
        if turn == (2 if self.consultation else 1):
            return delegate(2)
        return finish()

    async def complete(self, manifest, prepared, on_delta):
        packet = packets(prepared.input_items).get("swarm_delegation")
        if not packet:
            return await super().complete(manifest, prepared, on_delta)
        index = packet["worker_index"]
        with self.lock:
            self.worker_calls[index] += 1
            attempt = self.worker_calls[index]
        if index == 2 and attempt <= len(self.failures):
            async with asyncio.timeout(5):
                while not self.first_finished.is_set():
                    await asyncio.sleep(0.01)
            raise self.failures[attempt - 1]
        completion = await super().complete(manifest, prepared, on_delta)
        if index == 1:
            self.first_finished.set()
        return completion


def start_study(database, provider):
    runs, request = setup(database, provider, workers=2, parallel=2)
    queue, worker = RunQueue(runs), RunWorker(runs)
    with queue._admission() as conn:
        queue._start(conn, request, research_session=True)
    assert worker.run_once()
    return queue, worker, request.id, runs.get(request.id)


def test_repeatable_recovery_reuses_finished_work_and_the_review(database):
    provider = FailingWorker(
        error_for_code("server_error", status=200, shape="stream_error", request_id="req_first"),
        error_for_code("service_unavailable", status=503, request_id="req_second"),
        consultation=True,
    )
    queue, worker, run_id, paused = start_study(database, provider)
    assert paused.status == "paused", paused.stop_reason
    feedback = "Use the three-year horizon."
    review = ResumeRequest(
        checkpoint_id=paused.checkpoint_id,
        interrupt_id=paused.reviews[0].interrupt_id,
        decision="approve",
        feedback=feedback,
    )
    review_command = queue.resume(run_id, review)
    assert worker.run_once()
    failed = queue.runs.get(run_id)
    assert failed.status == "failed"
    assert failed.recovery_command_id == review_command.command_id
    assert failed.perspective_answers[0].feedback == feedback
    successes = {a.id: a for a in failed.model_attempts if a.status == "completed"}
    first_failure = next(a for a in failed.model_attempts if a.status == "failed")
    assert first_failure.provider_failure.model_dump() == {
        "http_status": 200,
        "source": "stream",
        "code": "server_error",
        "request_id": "req_first",
    }
    assert provider.worker_calls == {1: 1, 2: 1}
    assert not worker.run_once()

    with ThreadPoolExecutor(max_workers=2) as callers:
        results = list(
            callers.map(lambda _: queue.recover(run_id, review_command.command_id), range(2))
        )
    first_resume = results[0]
    assert first_resume.kind == "recover"
    assert results == [first_resume, first_resume]
    assert first_resume.command_id != review_command.command_id
    queued = queue.runs.get(run_id)
    assert queued.status == "queued" and queued.checkpoint_id == failed.checkpoint_id
    assert queue.resume(run_id, review) == review_command

    assert worker.run_once()
    failed_again = queue.runs.get(run_id)
    assert failed_again.status == "failed"
    assert failed_again.recovery_command_id == first_resume.command_id
    assert queue.recover(run_id, review_command.command_id) == first_resume
    assert not worker.run_once()
    second_resume = queue.recover(run_id, failed_again.recovery_command_id)
    assert second_resume.command_id != first_resume.command_id
    assert worker.run_once()

    finished = queue.runs.get(run_id)
    assert finished.status == "completed", finished.stop_reason
    assert finished.id == failed.id and finished.revision_id == failed.revision_id
    assert finished.workflow == failed.workflow and finished.artifacts == failed.artifacts
    assert finished.perspective_answers == failed.perspective_answers
    assert finished.recovery_command_id is None
    assert provider.worker_calls == {1: 1, 2: 3}
    attempts = {a.id: a for a in finished.model_attempts}
    assert {key: attempts[key] for key in successes} == successes
    assert {a.status for a in attempts.values() if a.path == first_failure.path} == {
        "failed",
        "completed",
    }
    assert sum(a.superseded_at is not None for a in attempts.values()) == 2
    assert attempts[first_failure.id].provider_failure == first_failure.provider_failure
    assert attempts[first_failure.id].input_artifact_id == first_failure.input_artifact_id
    with database.connection() as conn:
        failed_record = conn.execute(
            "SELECT response->>'status' AS status FROM run_commands WHERE id = %s",
            (review_command.command_id,),
        ).fetchone()
        assert failed_record["status"] == "failed"
        charges = conn.execute(
            "SELECT count(*) AS count FROM model_request_admissions d JOIN research_attempts a "
            "ON a.id = d.id WHERE a.run_id = %s",
            (run_id,),
        ).fetchone()
        assert charges["count"] == len(attempts)


def test_legacy_untyped_provider_failure_is_recoverable_via_api(database):
    provider = FailingWorker(ConnectionError(GENERIC_PROVIDER_ERROR))
    queue, worker, run_id, failed = start_study(database, provider)
    assert failed.status == "failed"
    failed_attempt = next(a for a in failed.model_attempts if a.status == "failed")
    assert failed_attempt.provider_failure is None
    with owner_client(create_app(database, provider=provider), workers=False) as client:
        path = f"/api/runs/{run_id}"
        response = client.get(path)
        failed_command = response.json()["recovery_command_id"]
        assert UUID(failed_command) == failed.recovery_command_id
        assert client.post(f"{path}/recover").json()["command_id"] == failed_command
        assert client.get(path).json()["status"] == "failed"
        rejected = client.post(f"{path}/recover", json={"failed_command_id": str(uuid4())})
        assert rejected.status_code == 409
        body = {"failed_command_id": failed_command}
        accepted = client.post(f"{path}/recover", json=body)
        assert accepted.status_code == 202
        assert accepted.json()["kind"] == "recover"
        assert client.post(f"{path}/recover", json=body).json() == accepted.json()
        assert client.get(path).json()["status"] == "queued"
    assert worker.run_once()
    assert queue.runs.get(run_id).status == "completed"
    assert provider.worker_calls == {1: 1, 2: 2}


@pytest.mark.parametrize(
    ("failure", "mark_unknown"),
    [
        (ConnectionError("Provider connection ended before a terminal event."), False),
        (error_for_code("context_length_exceeded", status=400), False),
        (error_for_code("subscription_sharing_usage_limit_exceeded", status=429), False),
        (error_for_code("server_error", status=500), True),
    ],
)
def test_recovery_rejects_permanent_and_uncertain_failures(database, failure, mark_unknown):
    provider = FailingWorker(failure)
    queue, worker, run_id, failed = start_study(database, provider)
    assert failed.status == "failed"
    if mark_unknown:
        # An interrupted sibling prevents replay even alongside a confirmed error.
        assert failed.recovery_command_id
        with database.connection() as conn:
            conn.execute(
                "UPDATE research_attempts SET status = 'unknown' WHERE run_id = %s "
                "AND path = 'root/team/lead-1/agent-1'",
                (run_id,),
            )
        assert queue.runs.get(run_id).recovery_command_id is None
    else:
        assert failed.recovery_command_id is None
    with pytest.raises(ConflictError, match="cannot be resumed"):
        queue.recover(run_id, failed.recovery_command_id or uuid4())
    assert not worker.run_once()
    assert provider.worker_calls == {1: 1, 2: 1}
