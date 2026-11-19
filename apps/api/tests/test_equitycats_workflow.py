"""Run the saved EquityCats graph with the real compiler and synthetic observations."""

import json
from pathlib import Path
from uuid import uuid4

import pytest
from equitycats_fixture import (
    BRIEF_PREFIX,
    MATCHED_CLOSE_URL,
    equitycats_completion,
    matched_close,
    timestamp_gap,
)
from test_research_runtime import approve
from test_web_research import WebProvider

from researchchain.artifacts import read_content
from researchchain.graph import Workflow
from researchchain.models import RunRequest
from researchchain.revisions import RevisionStore
from researchchain.runtime import RunStore

EXAMPLE = Path(__file__).resolve().parents[3] / "examples/equitycats-research.json"


class EquityCatsProvider(WebProvider):
    def __init__(self, ready_on, record_sources):
        super().__init__()
        self.ready_on = ready_on
        self.record_sources = record_sources

    async def complete(self, manifest, prepared, on_delta):
        completion = await super().complete(manifest, prepared, on_delta)
        return equitycats_completion(
            prepared, completion, ready_on=self.ready_on, record_sources=self.record_sources
        )


@pytest.mark.parametrize(
    ("ready_on", "record_sources"),
    [(2, True), (None, True), (1, False)],
    ids=["converges", "unresolved", "missing-provenance"],
)
def test_equitycats_research_revises_only_until_evidence_ready(database, ready_on, record_sources):
    workflow = Workflow.model_validate_json(EXAMPLE.read_bytes())
    workflow.research.model = "test-model"
    revision = RevisionStore(database).save(workflow)
    provider = EquityCatsProvider(ready_on, record_sources)
    store = RunStore(database, provider)
    run = store.start(
        RunRequest(
            id=uuid4(),
            revision_id=revision.id,
            brief=f"{BRIEF_PREFIX} Use the January event window and a five-session horizon.",
            provider_account_id=provider.account.id,
        )
    )
    completed = ready_on is not None and record_sources
    count = 2 if completed else 3
    loop = "root/evidence_loop"
    attempts = {attempt.path: attempt for attempt in run.model_attempts}
    events = {event.path: event for event in run.events}
    assert run.status == ("paused" if completed else "limited"), run.stop_reason
    for index in range(1, count + 1):
        prefix = f"{loop}/iteration-{index}"
        first = attempts[f"{prefix}/pricing"]
        followup = attempts[f"{prefix}/pricing/analyst-pass-2"]
        audit = attempts[f"{prefix}/audit"]
        method = events[f"{prefix}/method"].code
        gate = events[f"{prefix}/gate"].code
        assert first.result.next_lead == "Check contrary evidence"
        assert followup.result.conclusion.startswith(f"Pass {index}.")
        assert audit.result.revision_summary == (
            "ready" if ready_on and index >= ready_on else "needs_more"
        )
        if record_sources:
            trace = audit.result.web_research
            expected_urls = {"https://example.org/data"}
            if completed and index == count:
                expected_urls.add(MATCHED_CLOSE_URL)
                assert any(action.url == MATCHED_CLOSE_URL for action in trace.actions)
            assert {source.url for source in trace.sources if source.cited} == expected_urls
        assert gate.outputs.number == int(completed and index == count)
        if not record_sources:
            assert "no substantive captured citation or provider-recorded web citation" in (
                gate.outputs.text
            )
        elif index == 1:
            assert "blocking entries remain" in gate.outputs.text
        if index == 1:
            assert method.inputs.text == ""
            assert "Prior case to revisit" not in method.outputs.text
        else:
            prior_gate = events[f"{loop}/iteration-{index - 1}/gate"].code
            assert method.inputs.text == prior_gate.outputs.text
            assert prior_gate.outputs.text in method.outputs.text
            if ready_on != 1:
                assert timestamp_gap(index - 1) in method.outputs.text
                assert "different session closes" in method.outputs.text
            if index == 3:
                assert timestamp_gap(1) not in method.outputs.text
        for attempt in (first, followup):
            with database.connection() as conn:
                payload = json.loads(read_content(conn, attempt.input_artifact_id))
            packet = json.loads(payload["input"][0]["content"][0]["text"])
            assert packet["brief"] == run.brief
            assert packet["additional_context"] == method.outputs.text
            assert packet["human_feedback"] == ""
            assert any(item.get("type") == "function_call_output" for item in payload["input"]) == (
                attempt is followup
            )

    prefix = f"{loop}/iteration-{count}"
    if not completed:
        assert run.review is None and "exhausted 3 iterations" in run.stop_reason
        assert len(run.model_attempts) == 12
        assert f"{prefix}/retry_reason" in events
        assert all(not path.endswith("/proposal") for path in attempts)
        assert RunStore(database, provider).get(run.id) == run
        return

    assert run.review.path == f"{prefix}/owner_verdict"
    assert matched_close(1) in attempts[f"{prefix}/pricing/analyst-pass-2"].result.conclusion
    assert matched_close(1) in attempts[f"{prefix}/challenge"].result.conclusion
    assert matched_close(1) in attempts[f"{prefix}/audit"].result.conclusion
    assert attempts[f"{prefix}/proposal"].result.conclusion.startswith("Pass 2.")
    assert not any(path.startswith(f"{loop}/iteration-3/") for path in attempts)
    feedback = "Favor the rival until the second series confirms the signal."
    saved = RunStore(database, provider).resume(run.id, approve(run, feedback))
    assert saved.status == "completed", saved.stop_reason
    assert len(saved.model_attempts) == 10
    assert "Exit condition satisfied" in next(
        event.detail for event in saved.events if event.path == f"{loop}/check-2"
    )
    memo = next(attempt for attempt in saved.model_attempts if attempt.path == f"{prefix}/memo")
    assert feedback in memo.result.conclusion
    with database.connection() as conn:
        payload = json.loads(read_content(conn, memo.input_artifact_id))
    packet = json.loads(payload["input"][0]["content"][0]["text"])
    assert packet["human_feedback"] == feedback
    assert packet["prior_result"]["conclusion"] == attempts[f"{prefix}/proposal"].result.conclusion
