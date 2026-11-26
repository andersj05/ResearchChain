"""Live redirection and report handoffs using saved, synthetic swarm receipts."""

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import uuid4

import pytest
from access_fixtures import owner_client
from swarm_browser_fixture import result
from test_research_contracts import result_document
from test_research_sessions import request
from test_research_swarm import SwarmProvider, consult, delegate, finish, packets

from researchchain.artifacts import read_content
from researchchain.compiler import ExecutionStopped
from researchchain.dispatch import RunQueue
from researchchain.main import create_app
from researchchain.providers.chatgpt_auth import error_for_code
from researchchain.research import ResearchExecutor
from researchchain.research_recovery import MODEL_CALL_LIMIT_REASON, TOOL_CALL_LIMIT_REASON
from researchchain.runtime import RunStore
from researchchain.worker import RunWorker


class SteeringProvider(SwarmProvider):
    def __init__(self, next_action, *, hold=None, revisit=False, fail_at_handoff=False):
        super().__init__(next_action)
        self.hold = hold
        self.revisit = revisit
        self.fail_at_handoff = fail_at_handoff
        self.waiting = Event()
        self.editor_packet = None

    async def complete(self, manifest, prepared, on_delta):
        packet = packets(prepared.input_items)
        if "report_markdown" in prepared.schema["properties"]:
            self.calls.append(prepared)
            self.editor_packet = packet
            answer = result_document("custom")
            answer.update(
                hypotheses=[], report_markdown="# Confirmed findings\n\nSynthetic report."
            )
            return result(prepared.model, answer=answer)
        assignment = packet.get("swarm_delegation")
        if assignment and self.hold == (assignment["lead_index"], assignment["worker_index"]):
            self.waiting.set()
            while not self.released.is_set():
                await asyncio.sleep(0.02)
            if self.fail_at_handoff:
                raise error_for_code("server_error", status=503, shape="error_object")
            if self.revisit and not any(
                item.get("type") == "function_call_output" for item in prepared.input_items
            ):
                self.calls.append(prepared)
                return result(
                    prepared.model,
                    tool="pursue_lead",
                    arguments={
                        "lead": "Compare the two synthetic releases.",
                        "findings": "Initial finding.",
                    },
                )
        return await super().complete(manifest, prepared, on_delta)


def study(*, review_mode="never"):
    return request(
        brief="Handoff from independent synthetic investigations.",
        lead={"model": "analysis-model"},
        swarm={
            "lead_count": 2,
            "researchers_per_lead": 2,
            "max_parallel": 1,
            "max_lead_turns": 3,
            "allow_consultations": True,
        },
        max_passes=3,
        review_mode=review_mode,
    )


def start(client, setup):
    response = client.post("/api/research-sessions", json=setup.model_dump(mode="json"))
    assert response.status_code == 202, response.text
    return f"/api/research-sessions/{setup.id}"


@pytest.mark.parametrize("old_stop", [None, MODEL_CALL_LIMIT_REASON, TOOL_CALL_LIMIT_REASON])
def test_desk_retry_leaves_room_for_the_report_editor(database, monkeypatch, old_stop):
    class RetryBudgetProvider(SteeringProvider):
        failed = False

        async def complete(self, manifest, prepared, on_delta):
            assignment = packets(prepared.input_items).get("swarm_delegation")
            editor = "report_markdown" in prepared.schema["properties"]
            if assignment and not self.failed:
                self.failed = True
                self.calls.append(prepared)
                raise error_for_code("server_error", status=503, shape="error_object")
            if (assignment or editor) and not any(
                item.get("type") == "function_call_output" for item in prepared.input_items
            ):
                self.calls.append(prepared)
                return result(
                    prepared.model,
                    tool="pursue_lead",
                    arguments={
                        "lead": "Verify the synthetic finding.",
                        "findings": "Preliminary observation.",
                    },
                )
            return await super().complete(manifest, prepared, on_delta)

    provider = RetryBudgetProvider(lambda state: delegate(1) if state["turn"] == 1 else finish())
    runs = RunStore(database, provider)
    queue, worker = RunQueue(runs), RunWorker(runs)
    setup = request(
        lead={"model": "analysis-model"},
        swarm={"lead_count": 1, "researchers_per_lead": 1, "max_lead_turns": 2},
        max_passes=2,
        review_mode="never",
    )
    queue.start_session(setup)
    assert worker.run_once()
    failed = runs.get(setup.id)
    assert failed.status == "failed" and failed.recovery_command_id
    queue.recover(setup.id, failed.recovery_command_id)

    reserve = ResearchExecutor.reserve

    def legacy_reserve(executor, node, path, model):
        if path == "root/report/analyst-pass-2":
            raise ExecutionStopped(old_stop)
        return reserve(executor, node, path, model)

    with monkeypatch.context() as patch:
        if old_stop:
            patch.setattr(ResearchExecutor, "reserve", legacy_reserve)
        assert worker.run_once()
    before = runs.get(setup.id)
    if old_stop:
        assert before.status == "limited" and before.stop_reason == old_stop
        assert before.recovery_command_id and not before.recovery_requires_confirmation
        assert len(provider.calls) == before.usage.model_calls == 7
        assert [attempt.path for attempt in before.model_attempts if "/report" in attempt.path] == [
            "root/report"
        ]
        queue.recover(setup.id, before.recovery_command_id)
        assert worker.run_once()

    done = runs.get(setup.id)
    assert done.status == "completed", done.stop_reason
    assert done.revision_id == failed.revision_id and done.workflow == failed.workflow
    assert done.research_manifest == failed.research_manifest
    assert done.research_manifest.settings.limits.max_model_calls == 7
    assert done.research_manifest.settings.limits.max_tool_calls == 7
    assert len(provider.calls) == done.usage.model_calls == done.usage.tool_calls == 8
    editor = next(
        attempt for attempt in done.model_attempts if attempt.path == "root/report/analyst-pass-2"
    )
    assert editor.result.report_artifact.name == "report.md"
    assert sum(attempt.superseded_at is not None for attempt in done.model_attempts) == 1
    if old_stop:
        finished = {attempt.id: attempt for attempt in done.model_attempts}
        assert [finished[attempt.id] for attempt in before.model_attempts] == before.model_attempts
    with database.connection() as conn:
        admitted = conn.execute(
            "SELECT count(*) AS calls FROM model_request_admissions d "
            "JOIN research_attempts a ON a.id = d.id WHERE a.run_id = %s",
            (setup.id,),
        ).fetchone()
    assert admitted["calls"] == 8


def test_direct_a_researcher_and_a_lead_only_on_their_next_requests(database):
    def actions(state):
        return delegate(1, state["lead_index"]) if state["turn"] == 1 else finish()

    provider = SteeringProvider(actions, hold=(1, 1), revisit=True)
    runs = RunStore(database, provider)
    setup = study()
    with owner_client(create_app(database, provider), workers=False) as client:
        path = start(client, setup) + "/directions"
        with ThreadPoolExecutor(max_workers=1) as pool:
            active = pool.submit(RunWorker(runs).run_once)
            try:
                assert provider.waiting.wait(15)
                worker = {
                    "id": str(uuid4()),
                    "text": "Recheck the announcement date.",
                    "target_path": "root/team/lead-1/agent-1",
                }
                lead = {
                    "id": str(uuid4()),
                    "text": "Compare the inventory observation with orders.",
                    "target_path": "root/team/lead-2",
                }
                accepted = client.post(path, json=worker)
                assert accepted.status_code == 200, accepted.text
                assert client.post(path, json=worker).json() == accepted.json()
                assert client.post(path, json={**lead, "id": worker["id"]}).status_code == 409
                assert client.post(path, json=lead).status_code == 200
                assert (
                    client.post(
                        path,
                        json={
                            **lead,
                            "id": str(uuid4()),
                            "target_path": "root/team/lead-2/agent-2",
                        },
                    ).status_code
                    == 409
                )
            finally:
                provider.released.set()
            assert active.result(timeout=20)

    final = runs.get(setup.id)
    assert final.status == "completed", final.stop_reason
    received = {
        attempt.path: [str(note) for note in attempt.owner_direction_ids]
        for attempt in final.model_attempts
        if attempt.owner_direction_ids
    }
    assert received == {
        "root/team/lead-1/agent-1/analyst-pass-2": [worker["id"]],
        "root/team/lead-2/agent-1": [lead["id"]],
        "root/team/lead-2/turn-2": [lead["id"]],
    }
    with database.connection() as conn:
        attempts = {a.path: a for a in final.model_attempts}
        followup = attempts["root/team/lead-1/agent-1/analyst-pass-2"]
        payload = json.loads(read_content(conn, followup.input_artifact_id))
        assert packets(payload["input"])["owner_directions"][0]["text"] == worker["text"]


@pytest.mark.parametrize("provider_fails", [False, True])
def test_report_request_drains_admitted_work_and_skips_unstarted_assignments(
    database, provider_fails
):
    def actions(state):
        assert state["turn"] == 1, "The owner requested the report before a new lead turn."
        return delegate(2, state["lead_index"])

    provider = SteeringProvider(actions, hold=(2, 1), fail_at_handoff=provider_fails)
    runs = RunStore(database, provider)
    setup = study()
    with owner_client(create_app(database, provider), workers=False) as client:
        path = start(client, setup) + "/write-report"
        handoff = {"id": str(uuid4()), "text": "Lead with the strongest observation."}
        assert client.post(path, json=handoff).status_code == 409
        with ThreadPoolExecutor(max_workers=1) as pool:
            active = pool.submit(RunWorker(runs).run_once)
            try:
                assert provider.waiting.wait(15)
                before = runs.get(setup.id)
                assert before.status == "running" and before.can_request_report
                completed = next(
                    a for a in before.model_attempts if a.path.endswith("lead-1/agent-1")
                )
                assert completed.status == "completed"
                accepted = client.post(path, json=handoff)
                assert accepted.status_code == 200, accepted.text
                assert client.post(path, json=handoff).json() == accepted.json()
                assert client.post(path, json={**handoff, "id": str(uuid4())}).status_code == 409
            finally:
                provider.released.set()
            assert active.result(timeout=20)
        if provider_fails:
            failed = runs.get(setup.id)
            assert failed.status == "failed" and failed.recovery_command_id
            assert str(failed.owner_report_request.id) == handoff["id"]
            recovered = client.post(
                f"/api/runs/{setup.id}/recover",
                json={"failed_command_id": str(failed.recovery_command_id)},
            )
            assert recovered.status_code == 202, recovered.text
            assert RunWorker(runs).run_once()
        assert client.post(path, json=handoff).json() == accepted.json()
        client.cookies.clear()
        assert client.post(path, json=handoff).status_code == 401

    final = runs.get(setup.id)
    assert final.status == "completed", final.stop_reason
    assert next(a for a in final.model_attempts if a.id == completed.id) == completed
    assert not any("/agent-2" in a.path for a in final.model_attempts)
    assert provider.editor_packet["owner_report_request"] == accepted.json()
    packet = json.loads(provider.editor_packet["additional_context"])
    assert packet["handoff_requested"] is True
    assert len(packet["agents"]) == (1 if provider_fails else 2)
    assert len(packet["unfinished_assignments"]) == (3 if provider_fails else 2)
    assert all(lead["status"] == "unfinished" for lead in packet["leads"])


def test_report_request_continues_paused_consultations_without_recording_fake_answers(database):
    def actions(state):
        if state["lead_index"] == 1 and state["turn"] == 1:
            return delegate(1)
        return consult()

    provider = SteeringProvider(actions)
    runs = RunStore(database, provider)
    setup = study(review_mode="always")
    worker = RunWorker(runs)
    with owner_client(create_app(database, provider), workers=False) as client:
        path = start(client, setup) + "/write-report"
        assert worker.run_once()
        paused = runs.get(setup.id)
        assert paused.status == "paused", paused.stop_reason
        assert len(paused.reviews) == 2 and paused.can_request_report
        handoff = {"id": str(uuid4()), "text": "Call out the unanswered horizon question."}
        accepted = client.post(path, json=handoff)
        assert accepted.status_code == 200, accepted.text
        assert client.post(path, json=handoff).json() == accepted.json()
        assert runs.get(setup.id).status == "queued"
        assert worker.run_once()
    final = runs.get(setup.id)
    assert final.status == "completed", final.stop_reason
    assert not final.perspective_answers
    assert {a.id for a in paused.model_attempts} < {a.id for a in final.model_attempts}
    packet = json.loads(provider.editor_packet["additional_context"])
    decisions = [turn for lead in packet["leads"] for turn in lead["turns"]]
    assert [turn["status"] for turn in decisions if turn["action"] == "ask_expert"] == [
        "unanswered",
        "unanswered",
    ]
    assert provider.editor_packet["owner_report_request"]["text"] == handoff["text"]
