import asyncio
import json
from dataclasses import replace
from uuid import uuid4

import httpx
import pytest
from pydantic import ValidationError
from test_research_runtime import approve
from test_web_research import WebProvider, example

from researchchain.artifacts import read_content
from researchchain.graph import ResearchConfig
from researchchain.models import RunRequest
from researchchain.research_prompt import output_schema
from researchchain.revisions import RevisionStore
from researchchain.runtime import RunStore
from researchchain.sec_financials import INDEX_URL, SecLookup, lookup_sec_financials


def annual(year, value, **extra):
    return {
        "form": "10-K",
        "start": f"{year}-01-01",
        "end": f"{year}-12-31",
        "filed": f"{year + 1}-02-12",
        "accn": f"0001045810-25-{year:06d}",
        "val": value,
        **extra,
    }


def sec_server(request):
    assert "Authorization" not in request.headers
    assert request.headers["user-agent"] == "Fixture test@example.org"
    if str(request.url) == INDEX_URL:
        return httpx.Response(200, json={"0": {"ticker": "NVDA", "cik_str": 1045810}})
    assert str(request.url) == (
        "https://data.sec.gov/api/xbrl/companyconcept/CIK0001045810/us-gaap/NetIncomeLoss.json"
    )
    return httpx.Response(
        200,
        json={
            "tag": "NetIncomeLoss",
            "taxonomy": "us-gaap",
            "cik": 1045810,
            "entityName": "Test issuer",
            "units": {
                "USD": [
                    annual(2023, 40),
                    annual(2024, 50),
                    annual(2024, 52, form="10-K/A", filed="2025-03-02"),
                    annual(2024, 30, start="2024-10-01"),
                    annual(2025, 999, form="10-Q"),
                    annual(2025, True),
                    annual(2025, 500, accn="not a filing"),
                ]
            },
        },
    )


def test_unconfigured_sec_does_not_send_requests(monkeypatch):
    monkeypatch.delenv("RESEARCHCHAIN_SEC_USER_AGENT", raising=False)
    result = asyncio.run(lookup_sec_financials(SecLookup(ticker="NVDA", metric="revenue")))
    assert result.status == "unavailable" and "RESEARCHCHAIN_SEC_USER_AGENT" in result.detail
    assert not result.observations


def test_sec_errors_expose_gap_and_do_not_follow_redirect(monkeypatch):
    monkeypatch.setenv("RESEARCHCHAIN_SEC_USER_AGENT", "Fixture test@example.org")

    def redirect(request):
        assert str(request.url) == INDEX_URL
        return httpx.Response(302, headers={"Location": "https://example.org/other"})

    result = asyncio.run(
        lookup_sec_financials(
            SecLookup(ticker="NVDA", metric="revenue"), transport=httpx.MockTransport(redirect)
        )
    )
    assert result.status == "unavailable" and "302" in result.detail


def test_only_enabled_custom_models_can_request_typed_lookup():
    assert "sec_lookup" not in output_schema(custom=True)["properties"]
    assert "sec_financials" not in output_schema(custom=True, sec_financials=True)["properties"]
    with pytest.raises(ValidationError, match="custom"):
        ResearchConfig(sec_financials=True)
    with pytest.raises(ValidationError):
        SecLookup(ticker="https://example.org", metric="net_income")


def test_sec_request_from_model_records_facts_and_reaches_memo(database, monkeypatch):
    monkeypatch.setenv("RESEARCHCHAIN_SEC_USER_AGENT", "Fixture test@example.org")

    async def lookup(request):
        return await lookup_sec_financials(request, transport=httpx.MockTransport(sec_server))

    monkeypatch.setattr("researchchain.research.lookup_sec_financials", lookup)

    class SecProvider(WebProvider):
        async def complete(self, manifest, prepared, on_delta):
            completed = await super().complete(manifest, prepared, on_delta)
            if not prepared.sec_financials:
                return completed
            doc = json.loads(completed.text)
            doc["sec_lookup"] = {"ticker": "NVDA", "metric": "net_income"}
            return replace(completed, text=json.dumps(doc))

    workflow = example()
    workflow.research.model = "test-model"
    revision = RevisionStore(database).save(workflow)
    provider = SecProvider()
    store = RunStore(database, provider)
    first = store.start(
        RunRequest(
            id=uuid4(),
            revision_id=revision.id,
            brief="Research NVDA profits.",
            provider_account_id=provider.account.id,
        )
    )
    resumed = store.resume(first.id, approve(first, "Look at annual results."))
    assert resumed.status == "paused" and len(provider.calls) == 3
    receipt = resumed.model_attempts[1].result.sec_financials
    assert receipt.issuer == "Test issuer" and receipt.status == "available"
    assert [obs.value for obs in receipt.observations] == [40, 52]
    assert receipt.observations[-1].form == "10-K/A"
    with database.connection() as conn:
        saved = json.loads(read_content(conn, resumed.model_attempts[1].response_artifact_id))
    assert saved["sec_financials"] == receipt.model_dump(mode="json")
    packet = json.loads(provider.calls[-1].input_items[0]["content"][0]["text"])
    context = json.loads(packet["additional_context"])
    assert context["sec_financials"] == saved["sec_financials"]
    assert context["analytics"]["change"] == 12
    assert context["analytics"]["status"] == "filing_change"
