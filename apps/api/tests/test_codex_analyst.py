"""Model-directed Codex tool continuation, journaling and remote-capability boundaries."""

import asyncio
import json
import shutil
from dataclasses import replace
from uuid import uuid4

import httpx
import pytest
from test_chatgpt_provider import CLIENT, Harness, events
from test_research_runtime import approve
from test_web_research import WebProvider, example

from researchchain.artifacts import read_content
from researchchain.codex_analyst import run_codex_analyst, tool_call
from researchchain.graph import Workflow
from researchchain.models import RunRequest
from researchchain.providers.chatgpt_plan import ChatGPTPlan
from researchchain.research import ResearchExecutor
from researchchain.revisions import RevisionStore
from researchchain.runtime import RunStore


class AnalystProvider(WebProvider):
    """One synthetic web search and one text-only synthesis."""

    async def complete(self, manifest, prepared, on_delta):
        result = await super().complete(manifest, prepared, on_delta)
        if prepared.analyst_options is not None:
            response = result.analyst_response.copy()
            response["usage"] = {"input_tokens": 25}
            if response["output"][0]["type"] == "message":
                message = response["output"][0].copy()
                message["content"] = [
                    {"type": "output_text", "text": result.text, "annotations": []}
                ]
                return replace(
                    result, web_research=None, analyst_response={**response, "output": [message]}
                )
            return replace(result, analyst_response=response)
        return result


def test_analyst_validates_final_message_separately_from_streamed_commentary(tmp_path):
    harness = Harness(tmp_path / "auth")
    harness.complete()
    output = [
        {
            "type": "message",
            "id": phase,
            "role": "assistant",
            "phase": phase,
            "content": [{"type": "output_text", "text": text}],
        }
        for phase, text in (("commentary", "Checking sources."), ("final_answer", '{"answer":1}'))
    ]
    response = {"id": "synthetic", "status": "completed", "output": output}
    wire = events(
        {"type": "response.output_text.delta", "delta": "Checking sources."},
        {"type": "response.output_text.delta", "delta": '{"answer":1}'},
        {"type": "response.completed", "response": response},
    )
    result = asyncio.run(
        ChatGPTPlan(harness.auth).complete(
            "test-model",
            "test",
            account_id=CLIENT,
            analyst_options={"tools": []},
            transport=httpx.MockTransport(lambda _: httpx.Response(200, content=wire)),
        )
    )
    assert json.loads(result.text) == {"answer": 1}
    assert result.analyst_response["output"] == output


def start(database, provider, **limits):
    document = example().model_dump(mode="json")
    document["research"]["model"] = "test-model"
    document["research"]["limits"].update(limits)
    revision = RevisionStore(database).save(Workflow.model_validate(document))
    store = RunStore(database, provider)
    run = store.start(
        RunRequest(
            id=uuid4(),
            revision_id=revision.id,
            brief="Follow an analyst lead",
            provider_account_id=provider.account.id,
        )
    )
    assert run.status == "paused"
    return store, run


def test_analyst_reuses_completed_pass_and_keeps_prior_web_sources(database, monkeypatch):
    provider = AnalystProvider()
    store, first = start(database, provider)
    finish = ResearchExecutor.finish

    def interrupt_after_lead(self, *args, **kwargs):
        finish(self, *args, **kwargs)
        if kwargs.get("result") and kwargs["result"].next_lead:
            raise RuntimeError("Interrupted after confirmed lead")

    with monkeypatch.context() as patch:
        patch.setattr(ResearchExecutor, "finish", interrupt_after_lead)
        with pytest.raises(RuntimeError, match="confirmed lead"):
            store.resume(first.id, approve(first))
    recovered = store.recover(first.id)
    assert recovered.status == "paused" and recovered.review.node_id == "review"
    assert len(provider.calls) == 4
    interim, final = recovered.model_attempts[1:3]
    assert interim.result.next_lead == "Check contrary evidence"
    assert final.path == interim.path + "/analyst-pass-2"
    assert final.result.web_research == interim.result.web_research
    assert final.result.next_lead is None
    assert all(attempt.admission_policy_revision for attempt in recovered.model_attempts)
    with database.connection() as conn:
        followup = json.loads(read_content(conn, final.input_artifact_id))
    assert followup["tool_choice"] == "auto"
    assert any(item.get("type") == "function_call_output" for item in followup["input"])
    assert [t["type"] for t in followup["tools"]] == ["web_search", "namespace"]
    assert "competing explanation" in followup["instructions"]


def test_analyst_obeys_run_call_limit_between_passes(database):
    provider = AnalystProvider()
    store, first = start(database, provider, max_model_calls=2)
    limited = store.resume(first.id, approve(first))
    assert limited.status == "limited" and "Model-call" in limited.stop_reason
    assert len(provider.calls) == 2
    assert limited.model_attempts[-1].result.next_lead


def test_analyst_recovery_does_not_repeat_uncertain_followup(database):
    class Interrupted(AnalystProvider):
        async def complete(self, manifest, prepared, on_delta):
            if any(item.get("type") == "function_call_output" for item in prepared.input_items):
                self.crash = True
            return await super().complete(manifest, prepared, on_delta)

    provider = Interrupted()
    store, first = start(database, provider)
    with pytest.raises(RuntimeError, match="worker interruption"):
        store.resume(first.id, approve(first))
    recovered = store.recover(first.id)
    assert recovered.status == "failed" and "will not be resent" in recovered.stop_reason
    assert recovered.model_attempts[-1].status == "unknown"
    assert len(provider.calls) == 3


@pytest.mark.parametrize(
    "item",
    [
        {"type": "function_call", "name": "exec_command", "namespace": "functions"},
        {"type": "function_call", "name": "pursue_lead", "namespace": "ambient"},
        {"type": "custom_tool_call", "name": "shell"},
    ],
)
def test_unapproved_model_actions_are_never_relayed_to_codex(item):
    with pytest.raises(ValueError, match="outside this analyst"):
        tool_call({"output": [item]})


@pytest.mark.skipif(not shutil.which("codex"), reason="Local Codex CLI is optional")
def test_installed_codex_calls_real_dynamic_tool_using_synthetic_provider(database):
    provider = AnalystProvider()
    provider.run_analyst = run_codex_analyst
    store, first = start(database, provider)
    reviewed = store.resume(first.id, approve(first))
    assert reviewed.status == "paused", (
        reviewed.stop_reason,
        [(a.path, a.status, a.reason) for a in reviewed.model_attempts],
    )
    assert len(provider.calls) == 4
    first_pass, second_pass = provider.calls[1:3]
    assert first_pass.analyst_options["parallel_tool_calls"] is False
    assert not any(item.get("type") == "additional_tools" for item in first_pass.input_items)
    receipt = next(
        item for item in second_pass.input_items if item.get("type") == "function_call_output"
    )
    assert "example.org/data" in str(receipt["output"])
    assert reviewed.model_attempts[2].result.web_research.sources[0].cited
