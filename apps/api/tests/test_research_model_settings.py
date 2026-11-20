"""Effective research settings must reach the same bytes the owner can inspect later."""

import json
from uuid import uuid4

import httpx
import pytest
from graph_fixtures import chain, node
from test_research_contracts import result_document
from test_research_runtime import FakeProvider, approve
from test_research_team import analyst

from researchchain.artifacts import read_content
from researchchain.dispatch import RunQueue
from researchchain.graph import ResearchConfig, ResearchSettings, ResearchTeamConfig, Workflow
from researchchain.models import RunRequest
from researchchain.providers.chatgpt_auth import ChatGPTAuth
from researchchain.providers.credentials import ConnectionError
from researchchain.research import ChatGPTResearchProvider
from researchchain.research_prompt import MODEL_SETTINGS_VERSION, PreparedResearch, json_bytes
from researchchain.revisions import RevisionStore
from researchchain.runtime import RunStore


def study(database, provider, *steps, **defaults):
    document = chain(*steps, node("finish", "finish"))
    document.update(
        schema_version="0.3",
        research={
            "model": "test-model",
            "limits": {
                "max_model_calls": 12,
                "max_tool_calls": 12,
                "max_total_tokens": "as_needed",
            },
            **defaults,
        },
    )
    revision = RevisionStore(database).save(Workflow.model_validate(document))
    request = RunRequest(
        id=uuid4(),
        revision_id=revision.id,
        provider_account_id="oaiapp_fixture",
        brief="Compare the supplied synthetic measures.",
    )
    return RunStore(database, provider), request


def respond(request):
    body = json.loads(request.content)
    properties = body["text"]["format"]["schema"]["properties"]
    if "assignments" in properties:
        answer = {
            "assignments": [{"title": "Demand", "objective": "Review orders."}],
            "review_question": None,
        }
    else:
        answer = result_document("custom")
        if "review_question" in properties:
            answer["review_question"] = None
    text = json.dumps(answer)
    output = [
        {
            "type": "message",
            "id": "synthetic-item",
            "content": [{"type": "output_text", "text": text}],
        }
    ]
    if any(t.get("type") == "namespace" for t in body.get("tools", [])) and not any(
        item.get("type") == "function_call_output" for item in body["input"]
    ):
        text = ""
        output = [
            {
                "type": "function_call",
                "namespace": "research",
                "name": "pursue_lead",
                "id": "synthetic-lead",
                "call_id": "synthetic-lead",
                "arguments": json.dumps(
                    {"lead": "Test the orders.", "findings": "Initial observation."}
                ),
            }
        ]
    completed = {
        "id": "synthetic-response",
        "status": "completed",
        "model": body["model"],
        "output": output,
        "usage": {},
    }
    events = [
        {"type": "response.output_text.delta", "delta": text},
        {"type": "response.completed", "response": completed},
    ]
    return httpx.Response(
        200,
        headers={"Content-Type": "text/event-stream"},
        content="".join("data: " + json.dumps(e) + "\n\n" for e in events),
    )


def test_director_researcher_editor_and_direct_step_send_their_exact_saved_settings(
    database, monkeypatch
):
    fixture = FakeProvider()
    provider = ChatGPTResearchProvider()
    monkeypatch.setattr(provider, "status", fixture.status)
    monkeypatch.setattr(ChatGPTAuth, "access", lambda self: (fixture.account.id, "synthetic-token"))
    original_client = httpx.AsyncClient
    sent = []

    def capture(request):
        sent.append(request.content)
        return respond(request)

    def mock_client(*args, **kwargs):
        return original_client(*args, **{**kwargs, "transport": httpx.MockTransport(capture)})

    def harness(model, passes, step, guard, *, workspace=False):
        def codex_pass(history, request):
            return step(history, {**request, "reasoning": {"effort": "medium", "summary": "auto"}})

        return fixture.run_analyst(model, passes, codex_pass, guard, workspace=workspace)

    monkeypatch.setattr(httpx, "AsyncClient", mock_client)
    monkeypatch.setattr(provider, "run_analyst", harness)
    team = analyst(
        "team",
        model="analysis-model",
        reasoning_effort="low",
        verbosity="model_default",
        team={
            "max_agents": 1,
            "lead": {"model": "test-model", "verbosity": "high"},
            "researcher": {"reasoning_effort": "xhigh"},
        },
    )
    editor = analyst("report", reasoning_effort="model_default", verbosity="low")
    editor["inputs"] = {"context": {"source": "output", "node_id": "team", "port": "text"}}
    runs, setup = study(
        database,
        provider,
        analyst("direct", analyst=None),
        team,
        editor,
        reasoning_effort="medium",
        verbosity="medium",
    )
    run = runs.start(setup)
    assert run.status == "completed", run.stop_reason
    expected = {
        "root/direct": ("test-model", {"effort": "medium"}, "medium"),
        "root/team/plan": ("test-model", {"effort": "low"}, "high"),
        "root/team/agent-1": ("analysis-model", {"effort": "xhigh", "summary": "auto"}, None),
        "root/report": ("test-model", {"summary": "auto"}, "low"),
    }
    expected["root/team/agent-1/analyst-pass-2"] = expected["root/team/agent-1"]
    expected["root/report/analyst-pass-2"] = expected["root/report"]
    assert {a.path for a in run.model_attempts} == set(expected)
    with database.connection() as conn:
        for attempt, raw in zip(run.model_attempts, sent, strict=True):
            assert read_content(conn, attempt.input_artifact_id) == raw
            body = json.loads(raw)
            model, reasoning, verbosity = expected[attempt.path]
            assert body["model"] == attempt.model == model
            assert body["reasoning"] == reasoning and body["text"].get("verbosity") == verbosity
            assert body["text"]["format"]["strict"]
            if attempt.path not in {"root/direct", "root/team/plan"}:
                assert "reasoning.encrypted_content" in body["include"]


@pytest.mark.parametrize(
    "override, message",
    [
        ({"model": "analysis-model"}, "reasoning effort 'medium'"),
        (
            {"model": "analysis-model", "reasoning_effort": "model_default"},
            "response verbosity 'high'",
        ),
        ({"model": "unavailable-fixture"}, "Unavailable: unavailable-fixture"),
    ],
)
def test_unsupported_effective_role_blocks_admission_before_any_attempt(
    database, override, message
):
    provider = FakeProvider()
    team = analyst("team", team={"max_agents": 1, "lead": override})
    runs, setup = study(database, provider, team, reasoning_effort="medium", verbosity="high")
    with pytest.raises(ConnectionError, match=message):
        RunQueue(runs).start(setup)
    assert not provider.calls
    with database.connection() as conn:
        assert not conn.execute("SELECT 1 FROM runs").fetchone()
        assert not conn.execute("SELECT 1 FROM research_attempts").fetchone()


def test_retry_keeps_pinned_model_settings_when_the_account_catalog_changes(database, monkeypatch):
    provider = FakeProvider()
    runs, setup = study(
        database, provider, analyst("direct", analyst=None), reasoning_effort="high"
    )
    queue = RunQueue(runs)
    receipt = queue.start(setup)

    def unexpected():
        raise AssertionError("An admitted run retry must not look up the model catalog again.")

    monkeypatch.setattr(provider, "status", unexpected)
    assert queue.start(setup) == receipt
    assert not provider.calls


def test_unconfigured_documents_and_codex_requests_keep_their_legacy_bytes():
    assert ResearchTeamConfig(max_agents=3).model_dump_json() == '{"max_agents":3}'
    assert ResearchTeamConfig(max_agents=3, lead={}).model_dump_json() == '{"max_agents":3}'
    assert ResearchConfig().model_dump_json() == (
        '{"type":"research","stage":"hypothesize","prompt_version":"research-1",'
        '"web_search":false,"sec_financials":false}'
    )
    assert list(ResearchSettings().model_dump()) == ["provider", "model", "billing", "limits"]
    prepared = PreparedResearch("Synthetic", [], {}, {}, None, "test-model")
    original = {
        "model": "test-model",
        "input": [],
        "instructions": "Synthetic",
        "store": False,
        "stream": True,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "research_result",
                "strict": True,
                "schema": {},
            }
        },
    }
    assert json_bytes(prepared.request_body()) == json_bytes(original)
    harness = {
        "reasoning": {"effort": "low", "summary": "auto"},
        "include": ["reasoning.encrypted_content"],
    }
    prepared.analyst_options = harness
    assert json_bytes(prepared.request_body()) == json_bytes({**original, **harness})


@pytest.mark.parametrize("historical", [False, True])
def test_unset_fields_follow_the_wire_version_pinned_before_a_durable_review(
    database, monkeypatch, historical
):
    from researchchain import runtime

    provider = FakeProvider()
    harness = provider.run_analyst
    reasoning_item = {"type": "reasoning", "id": "synthetic-history", "encrypted_content": "opaque"}

    def using_native_settings(model, passes, step, guard, *, workspace=False):
        def relay(history, request):
            native = {
                **request,
                "input": [reasoning_item, *request["input"]],
                "reasoning": {"effort": "medium", "summary": "auto"},
                "text": {"verbosity": "high", "format": {"type": "text"}},
            }
            return step(history, native)

        return harness(model, passes, relay, guard, workspace=workspace)

    monkeypatch.setattr(provider, "run_analyst", using_native_settings)
    # This model's catalog advertises low/high/xhigh and no verbosity. The local
    # harness suggests medium/high independently of the account's actual catalog.
    runs, setup = study(
        database, provider, node("review", "review"), analyst("analyst", model="analysis-model")
    )
    setup = setup.model_copy(update={"brief": "Follow an analyst lead"})
    make_manifest = runtime.make_manifest

    def historical_manifest(*args):
        manifest = make_manifest(*args)
        manifest.tool_config.pop("model_settings_version")
        return manifest

    with monkeypatch.context() as before_upgrade:
        if historical:
            before_upgrade.setattr(runtime, "make_manifest", historical_manifest)
        paused = runs.start(setup)
    assert paused.status == "paused" and not provider.calls
    assert paused.research_manifest.tool_config.get("model_settings_version") == (
        None if historical else MODEL_SETTINGS_VERSION
    )

    def unexpected():
        raise AssertionError("Retry and resume must use the already pinned model settings.")

    monkeypatch.setattr(provider, "status", unexpected)
    assert runs.start(setup).research_manifest == paused.research_manifest
    done = runs.resume(setup.id, approve(paused))
    assert done.status == "completed" and len(done.model_attempts) == 2
    with database.connection() as conn:
        for attempt in done.model_attempts:
            body = json.loads(read_content(conn, attempt.input_artifact_id))
            assert body["model"] == "analysis-model"
            expected = (
                {"effort": "medium", "summary": "auto"} if historical else {"summary": "auto"}
            )
            assert body["reasoning"] == expected and "verbosity" not in body["text"]
            assert body["text"]["format"]["type"] == "json_schema"
            assert (
                reasoning_item in body["input"] and "reasoning.encrypted_content" in body["include"]
            )
        assert any(item.get("type") == "function_call_output" for item in body["input"])
