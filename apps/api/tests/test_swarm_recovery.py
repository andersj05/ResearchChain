"""Explicit recovery preserves the exact swarm, completed receipts, and owner judgment."""

import asyncio
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import UUID, uuid4

import pytest
from access_fixtures import owner_client
from test_research_swarm import SwarmProvider, consult, delegate, finish, packets, setup

from researchchain import research_perspectives, research_swarm
from researchchain.compiler import ExecutionStopped
from researchchain.controls import ACTIVE_TIME_LIMIT_REASON
from researchchain.dispatch import RunQueue
from researchchain.main import create_app
from researchchain.models import ResumeRequest
from researchchain.providers.chatgpt_auth import (
    GENERIC_PROVIDER_ERROR,
    PROVIDER_OVERLOAD_MESSAGE,
    error_for_code,
)
from researchchain.providers.credentials import ConnectionError
from researchchain.research import ResearchExecutor
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


def start_study(database, provider, *, leads=1):
    runs, request = setup(database, provider, leads=leads, workers=2, parallel=2)
    queue, worker = RunQueue(runs), RunWorker(runs)
    with queue._admission() as conn:
        queue._start(conn, request, research_session=True)
    assert worker.run_once()
    return queue, worker, request.id, runs.get(request.id)


@pytest.mark.parametrize("unfinished", [False, True])
def test_desk_resumes_a_clean_legacy_timer_stop(database, monkeypatch, unfinished):
    original_guard = ResearchExecutor.guard

    def old_timer(executor, path, count=False, *, settling=False):
        original_guard(executor, path, count, settling=settling)
        if path == "root/team":
            raise ExecutionStopped(ACTIVE_TIME_LIMIT_REASON)

    provider = FailingWorker()
    with monkeypatch.context() as patch:
        patch.setattr(ResearchExecutor, "guard", old_timer)
        queue, worker, run_id, stopped = start_study(database, provider)

    pinned_limit = stopped.workflow.budgets.max_active_seconds
    assert pinned_limit is not None
    assert stopped.status == "limited" and stopped.stop_reason == ACTIVE_TIME_LIMIT_REASON
    assert stopped.recovery_command_id and not stopped.recovery_requires_confirmation
    assert len(stopped.model_attempts) == 5
    assert all(attempt.status == "completed" for attempt in stopped.model_attempts)
    with database.connection() as conn:
        conn.execute(
            "UPDATE run_controls SET active_seconds = %s WHERE run_id = %s",
            (pinned_limit + 1, run_id),
        )
        if unfinished:
            conn.execute(
                "UPDATE research_attempts SET status = 'limited', reason = %s, "
                "response_id = NULL, result = NULL, response_artifact_id = NULL "
                "WHERE run_id = %s AND path LIKE '%%/agent-2'",
                (ACTIVE_TIME_LIMIT_REASON, run_id),
            )
    before = queue.runs.get(run_id)
    if unfinished:
        assert before.recovery_command_id is None
        with pytest.raises(ConflictError, match="cannot be resumed"):
            queue.recover(run_id, stopped.recovery_command_id, confirm_unrecorded=True)
        assert not worker.run_once()
        return
    path = f"/api/runs/{run_id}/recover"
    with owner_client(create_app(database, provider=provider), workers=False) as client:
        request = {"failed_command_id": str(stopped.recovery_command_id)}
        accepted = client.post(path, json=request)
        assert accepted.status_code == 202, accepted.text
        assert client.post(path, json=request).json() == accepted.json()
    assert worker.run_once()
    finished = queue.runs.get(run_id)
    assert finished.status == "completed", finished.stop_reason
    assert finished.workflow == stopped.workflow and finished.revision_id == stopped.revision_id
    assert finished.model_attempts == before.model_attempts
    assert finished.usage.active_seconds >= before.usage.active_seconds > pinned_limit
    assert provider.worker_calls == {1: 1, 2: 1}


@pytest.mark.parametrize("already_failed", [False, True])
def test_recovery_replays_one_answer_then_pauses_for_the_other_lead(
    database, monkeypatch, already_failed
):
    provider = SwarmProvider(lambda state: consult() if state["turn"] == 1 else finish())
    queue, worker, run_id, paused = start_study(database, provider, leads=2)
    assert paused.status == "paused"
    lead_one, lead_two = paused.reviews

    def answer(snapshot, review, feedback):
        queue.resume(
            run_id,
            ResumeRequest(
                checkpoint_id=snapshot.checkpoint_id,
                interrupt_id=review.interrupt_id,
                decision="approve",
                feedback=feedback,
            ),
        )
        assert worker.run_once()
        return queue.runs.get(run_id)

    def recover(snapshot):
        assert snapshot.recovery_command_id and not snapshot.recovery_requires_confirmation
        queue.recover(run_id, snapshot.recovery_command_id)
        assert worker.run_once()
        return queue.runs.get(run_id)

    request_perspectives = research_swarm.request_perspectives

    def legacy_timer(run_id, node_id, questions, *args):
        if [question.action_path for question in questions] == [lead_two.path]:
            raise ExecutionStopped(ACTIVE_TIME_LIMIT_REASON)
        return request_perspectives(run_id, node_id, questions, *args)

    with monkeypatch.context() as patch:
        patch.setattr(research_swarm, "request_perspectives", legacy_timer)
        stopped = answer(paused, lead_one, "Use the three-year horizon.")
    assert stopped.status == "limited" and stopped.stop_reason == ACTIVE_TIME_LIMIT_REASON
    assert all(attempt.status == "completed" for attempt in stopped.model_attempts)

    if already_failed:
        interrupt = research_perspectives.interrupt

        def legacy_interrupt(payload):
            reply = interrupt(payload)
            if [question["action_path"] for question in payload["questions"]] == [lead_two.path]:
                assert reply["interrupt_id"] == lead_one.interrupt_id
                raise ExecutionStopped(research_perspectives.LEGACY_REPLAY_STOP_REASON, "failed")
            return reply

        with monkeypatch.context() as patch:
            patch.setattr(research_perspectives, "interrupt", legacy_interrupt)
            stopped = recover(stopped)
        assert stopped.status == "failed"

    resumed = recover(stopped)
    assert resumed.status == "paused", resumed.stop_reason
    assert [review.interrupt_id for review in resumed.reviews] == [lead_two.interrupt_id]
    assert resumed.model_attempts == stopped.model_attempts
    assert resumed.perspective_answers == stopped.perspective_answers
    finished = answer(resumed, lead_two, "Use one quarter.")
    assert finished.status == "completed", finished.stop_reason
    assert [reply.feedback for reply in finished.perspective_answers] == [
        "Use the three-year horizon.",
        "Use one quarter.",
    ]
    assert len(provider.calls) == len(finished.model_attempts) == 5


def test_repeatable_recovery_reuses_finished_work_and_the_review(database):
    provider = FailingWorker(
        error_for_code(
            "server_is_overloaded", status=200, shape="stream_error", request_id="req_first"
        ),
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
        "code": "server_is_overloaded",
        "request_id": "req_first",
    }
    assert failed.stop_reason == PROVIDER_OVERLOAD_MESSAGE
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


class ParallelOverload(FailingWorker):
    def __init__(self, stopping: Event):
        super().__init__()
        self.second_admitted = Event()
        self.stopping = stopping

    async def complete(self, manifest, prepared, on_delta):
        assignment = packets(prepared.input_items).get("swarm_delegation")
        if not assignment:
            return await super().complete(manifest, prepared, on_delta)
        index = assignment["worker_index"]
        if index == 1 and not self.worker_calls[1]:
            self.worker_calls[index] += 1
            async with asyncio.timeout(10):
                while not self.second_admitted.is_set():
                    await asyncio.sleep(0.01)
            raise error_for_code("server_is_overloaded", status=200, shape="stream_error")
        if index == 2 and not self.worker_calls[2]:
            self.second_admitted.set()
            async with asyncio.timeout(10):
                while not self.stopping.is_set():
                    await asyncio.sleep(0.01)
            # The normal control poll gets a chance to observe the first failure.
            await asyncio.sleep(0.3)
        return await super().complete(manifest, prepared, on_delta)


@pytest.mark.parametrize("legacy_peer", [False, True])
def test_overload_preserves_admitted_peer_or_replays_it_only_after_confirmation(
    database, monkeypatch, legacy_peer
):
    stopping = Event()
    stop_team = ResearchExecutor.stop_team

    def signal_stop(executor, reason, status):
        stop_team(executor, reason, status)
        if reason == PROVIDER_OVERLOAD_MESSAGE:
            stopping.set()

    monkeypatch.setattr(ResearchExecutor, "stop_team", signal_stop)
    provider = ParallelOverload(stopping)
    queue, worker, run_id, original = start_study(database, provider)
    assert original.status == "failed" and original.recovery_command_id
    peer = next(a for a in original.model_attempts if a.path.endswith("/agent-2"))
    assert peer.status == "completed" and not original.recovery_requires_confirmation
    if legacy_peer:
        # Reproduce the old worker's untyped, admitted sibling and the saved generic reason.
        with database.connection() as conn, conn.transaction():
            conn.execute(
                "UPDATE run_controls SET reason = %s WHERE run_id = %s",
                (GENERIC_PROVIDER_ERROR, run_id),
            )
            conn.execute(
                "UPDATE research_attempts SET reason = %s WHERE run_id = %s AND status = 'failed'",
                (GENERIC_PROVIDER_ERROR, run_id),
            )
            conn.execute(
                "UPDATE research_attempts SET status = 'failed', reason = %s, "
                "response_id = NULL, result = NULL, response_artifact_id = NULL WHERE id = %s",
                (GENERIC_PROVIDER_ERROR, peer.id),
            )
    failed = queue.runs.get(run_id)
    assert failed.stop_reason == PROVIDER_OVERLOAD_MESSAGE
    assert bool(failed.recovery_requires_confirmation) is legacy_peer

    with owner_client(create_app(database, provider=provider), workers=False) as client:
        path = f"/api/runs/{run_id}"
        request = {"failed_command_id": str(failed.recovery_command_id)}
        if legacy_peer:
            rejected = client.post(f"{path}/recover", json=request)
            assert rejected.status_code == 409 and "Confirm" in rejected.json()["detail"]
            assert not worker.run_once()
            request["confirm_unrecorded"] = True
        response = client.post(f"{path}/recover", json=request)
        assert response.status_code == 202, response.text
        assert client.post(f"{path}/recover", json=request).json() == response.json()
    assert worker.run_once()
    finished = queue.runs.get(run_id)
    assert finished.status == "completed", finished.stop_reason
    assert provider.worker_calls == {1: 2, 2: 2 if legacy_peer else 1}
    saved_peer = next(a for a in finished.model_attempts if a.id == peer.id)
    assert bool(saved_peer.superseded_at) is legacy_peer


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
        queue.recover(run_id, failed.recovery_command_id or uuid4(), confirm_unrecorded=True)
    assert not worker.run_once()
    assert provider.worker_calls == {1: 1, 2: 1}
