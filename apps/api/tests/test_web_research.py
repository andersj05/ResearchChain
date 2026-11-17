"""Hosted search provenance, opt-in boundaries, and the real example calculations."""

import asyncio
import json
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from pydantic import ValidationError
from test_chatgpt_provider import CLIENT, Harness, events
from test_research_runtime import FakeProvider, approve

from researchchain.artifacts import read_content
from researchchain.code_execution import CodeExecutionError, execute_code
from researchchain.code_models import CodeInputs
from researchchain.graph import ResearchConfig, Workflow
from researchchain.models import RunRequest
from researchchain.providers.chatgpt_plan import ChatGPTPlan
from researchchain.research_models import ResearchResult
from researchchain.research_prompt import output_schema, web_prompt_hash
from researchchain.revisions import RevisionStore
from researchchain.runtime import RunStore
from researchchain.web_research import read_web_research

EXAMPLE = Path(__file__).resolve().parents[3] / "examples/idea-research.json"
WEB_OUTPUT = [
    {
        "id": "ws_1",
        "type": "web_search_call",
        "status": "completed",
        "action": {
            "type": "search",
            "queries": ["synthetic observations"],
            "sources": [
                {"url": "https://example.org/data", "title": "Synthetic observations"},
                {"url": "javascript:alert(1)", "title": "Invalid link"},
            ],
        },
    },
    {
        "id": "msg_1",
        "type": "message",
        "content": [
            {
                "type": "output_text",
                "annotations": [
                    {
                        "type": "url_citation",
                        "url": "https://example.org/data",
                        "title": "Synthetic observations",
                    }
                ],
            }
        ],
    },
]


def example():
    return Workflow.model_validate_json(EXAMPLE.read_text(encoding="utf-8"))


def data_block(**changes):
    data = {
        "source": "Synthetic fixture, not market data",
        "as_of": "2026-01-01",
        "x_label": "X",
        "x_unit": "units",
        "y_label": "Y",
        "y_unit": "units",
        "basis": "supplied_numeric",
        "observations": [
            {"period": "A", "x": 1, "y": 3},
            {"period": "B", "x": 2, "y": 5},
            {"period": "C", "x": 3, "y": 7},
        ],
        "scenario_x": [2, 4],
    }
    data.update(changes)
    return "My idea\n```research-data\n" + json.dumps(data) + "\n```"


def calculate(brief, **result):
    config = next(n.config for n in example().nodes if n.id == "analytics")
    return execute_code(
        config,
        CodeInputs(
            text=json.dumps({"conclusion": "Research notes", **result}),
            brief=brief,
            artifact_count=0,
            iteration=0,
        ),
    )


def test_web_search_is_explicit_and_canonical_defaults_stay_compatible():
    workflow = example()
    document = workflow.canonical_document()
    assert document["nodes"][0]["config"]["web_search"] == "auto"
    assert "web_search" not in document["nodes"][4]["config"]
    assert document["nodes"][2]["config"]["web_search"] is True
    with pytest.raises(ValidationError, match="custom"):
        ResearchConfig(web_search=True)
    assert "web_research" not in output_schema(custom=True)["properties"]
    assert "WebResearch" not in output_schema(custom=True).get("$defs", {})


def test_provider_captures_streamed_actions_without_inventing_sources(tmp_path):
    harness = Harness(tmp_path / "auth")
    harness.complete()

    def handle(request):
        body = json.loads(request.content)
        assert body["tools"] == [{"type": "web_search"}]
        assert body["include"] == ["web_search_call.action.sources"]
        assert "max_tool_calls" not in body and "max_output_tokens" not in body
        return httpx.Response(
            200,
            content=events(
                *[{"type": "response.output_item.done", "item": item} for item in WEB_OUTPUT],
                {
                    "type": "response.output_text.delta",
                    "delta": "A model claim https://invented.example",
                },
                {
                    "type": "response.completed",
                    "response": {"id": "resp_web", "status": "completed", "output": []},
                },
            ),
        )

    result = asyncio.run(
        ChatGPTPlan(harness.auth).complete(
            "test-model",
            "test",
            account_id=CLIENT,
            web_search=True,
            transport=httpx.MockTransport(handle),
        )
    )
    assert len(result.web_research.actions) == 1
    assert len(result.web_research.sources) == 1
    assert result.web_research.sources[0].cited
    assert result.web_research.sources[0].url == "https://example.org/data"


def test_trace_deduplicates_and_bounds_metadata():
    output = [
        *WEB_OUTPUT,
        {
            "type": "web_search_call",
            "action": {"sources": [{"url": f"https://example.org/{i}"} for i in range(250)]},
        },
    ]
    trace = read_web_research({"output": output})
    assert len(trace.sources) == 200 and trace.truncated
    assert trace.sources[0].cited


def test_hosted_finance_reference_is_not_dropped_or_treated_as_a_url():
    trace = read_web_research(
        {
            "output": [
                {
                    "type": "web_search_call",
                    "action": {
                        "sources": [
                            {"type": "url", "url": "oai-finance"},
                            {"type": "api", "name": "oai-finance", "url": None},
                            {"type": "api", "name": "oai-weather"},
                            {"type": "url", "url": "javascript:oai-finance"},
                        ]
                    },
                },
            ]
        }
    )
    assert trace.feeds == ["oai-finance", "oai-weather"] and not trace.sources


def test_example_calculates_known_fit_and_marks_extrapolation():
    result = calculate(data_block())
    analytics = json.loads(result.outputs.text)["analytics"]
    assert result.outputs.number == pytest.approx(2)
    assert analytics["intercept"] == pytest.approx(1)
    assert analytics["correlation"] == pytest.approx(1)
    assert analytics["r_squared"] == pytest.approx(1)
    assert analytics["scenarios"] == [
        {"x": 2, "y": 5, "extrapolation": False},
        {"x": 4, "y": 9, "extrapolation": True},
    ]
    assert (
        json.loads(calculate("Just a chart and a thesis").outputs.text)["analytics"]["status"]
        == "needs_data"
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"observations": [{"period": "A", "x": 1, "y": 2}] * 3},
        {"observations": [{"period": p, "x": 1, "y": 2} for p in "ABC"]},
        {"observations": [{"period": p, "x": "1", "y": 2} for p in "ABC"]},
        {"source": ""},
        {"scenario_x": [True]},
        {"basis": "verified_chart_pixels"},
    ],
)
def test_example_rejects_ambiguous_or_invalid_numeric_inputs(changes):
    with pytest.raises(CodeExecutionError):
        calculate(data_block(**changes))


def test_constant_y_has_no_defined_correlation():
    result = calculate(
        data_block(observations=[{"period": str(x), "x": x, "y": 7} for x in [1, 2, 3]])
    )
    analytics = json.loads(result.outputs.text)["analytics"]
    assert analytics["slope"] == 0 and analytics["intercept"] == 7
    assert analytics["correlation"] is None and analytics["r_squared"] is None


def test_memo_packet_prioritizes_cited_sources_within_its_size_limit():
    cited = {"url": "https://example.org/data", "title": "Observations", "cited": True}
    trace = {
        "feeds": ["oai-finance"],
        "observed_at": "2026-11-17T20:00:00Z",
        "sources": [
            {"url": f"https://example.org/{index}/" + "x" * 3900, "cited": False}
            for index in range(5)
        ]
        + [cited],
    }
    packet = json.loads(calculate("Explore the idea", web_research=trace).outputs.text)
    assert packet["web_sources"][0] == cited
    assert len(packet["web_sources"]) < len(trace["sources"])
    assert packet["source_list_truncated"]
    assert packet["web_feeds"] == trace["feeds"]
    assert packet["web_observed_at"] == trace["observed_at"]


class WebProvider(FakeProvider):
    async def complete(self, manifest, prepared, on_delta):
        result = await super().complete(manifest, prepared, on_delta)
        if prepared.web_search:
            document = json.loads(result.text)
            document["conclusion"] = "Synthetic research [Reference](https://example.org/data)."
            return replace(
                result,
                text=json.dumps(document),
                web_research=read_web_research({"output": WEB_OUTPUT}),
            )
        return result


@pytest.mark.parametrize("has_web", [True, False])
def test_example_human_checkpoints_provenance_and_recovery(database, has_web):
    workflow = example().model_copy(
        update={"research": example().research.model_copy(update={"model": "test-model"})}
    )
    revision = RevisionStore(database).save(workflow)
    provider = WebProvider() if has_web else FakeProvider()
    first = RunStore(database, provider).start(
        RunRequest(
            id=uuid4(),
            revision_id=revision.id,
            brief=data_block(),
            provider_account_id=provider.account.id,
        )
    )
    assert first.status == "paused" and len(provider.calls) == 1
    assert first.research_manifest.tool_config["web_prompt_hash"] == web_prompt_hash()
    resumed = RunStore(database, provider).resume(
        first.id, approve(first, "Focus on the counterargument.")
    )
    if not has_web:
        assert resumed.status == "failed"
        assert "did not complete a web search" in resumed.model_attempts[-1].reason
        return
    assert resumed.status == "paused" and resumed.review.node_id == "review"
    assert len(provider.calls) == 3
    trace = resumed.model_attempts[1].result.web_research
    assert trace.sources[0].cited
    with database.connection() as conn:
        artifact = read_content(conn, resumed.model_attempts[1].response_artifact_id)
    assert json.loads(artifact)["web_research"]["sources"][0]["url"] == "https://example.org/data"
    packet = json.loads(provider.calls[2].input_items[0]["content"][0]["text"])
    context = json.loads(packet["additional_context"])
    assert context["analytics"]["slope"] == 2
    assert context["web_sources"][0]["url"] == "https://example.org/data"
    assert packet["human_feedback"] == "Focus on the counterargument."
    final = RunStore(database, provider).resume(first.id, approve(resumed, "Synthetic approval"))
    assert final.status == "completed" and len(provider.calls) == 3
    assert RunStore(database, provider).get(first.id).model_attempts[1].result.web_research == trace
    forged = resumed.model_attempts[1].result.model_dump(mode="json")
    with pytest.raises(ValidationError, match="Extra inputs"):
        ResearchResult.model_validate(forged)
