"""Read-only model-selected SEC company concepts, with filing-level provenance."""

import asyncio
import json
import math
import os
import re
from datetime import UTC, date, datetime
from typing import Annotated, Any, Literal

import httpx
from pydantic import Field, StrictInt, ValidationError

from researchchain.graph import StrictModel

Metric = Literal["revenue", "net_income", "operating_income", "operating_cash_flow"]
CONCEPTS: dict[Metric, str] = {
    "revenue": "RevenueFromContractWithCustomerExcludingAssessedTax",
    "net_income": "NetIncomeLoss",
    "operating_income": "OperatingIncomeLoss",
    "operating_cash_flow": "NetCashProvidedByUsedInOperatingActivities",
}
INDEX_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_TOOL_VERSION = "sec-companyconcept-annual-usd-1"


class SecLookup(StrictModel):
    ticker: str = Field(pattern=r"^[A-Z0-9][A-Z0-9.-]{0,13}$")
    metric: Metric


class SecObservation(StrictModel):
    start: date
    end: date
    filed: date
    accession: str = Field(pattern=r"^[0-9]{10}-[0-9]{2}-[0-9]{6}$")
    form: Literal["10-K", "10-K/A"]
    value: StrictInt | Annotated[float, Field(allow_inf_nan=False, strict=True)]
    unit: Literal["USD"] = "USD"


class SecFinancials(StrictModel):
    request: SecLookup
    status: Literal["available", "unavailable"] = "unavailable"
    retrieved_at: datetime
    cik: str | None = None
    issuer: str | None = None
    source_url: str | None = None
    observations: list[SecObservation] = Field(default_factory=list, max_length=5)
    detail: str = ""


async def _document(client: httpx.AsyncClient, url: str) -> dict[str, Any]:
    async with client.stream("GET", url) as response:
        response.raise_for_status()
        content = bytearray()
        async for chunk in response.aiter_bytes():
            if len(content) + len(chunk) > 4 * 1024 * 1024:
                raise ValueError("The SEC response exceeded the lookup size limit.")
            content.extend(chunk)
    document = json.loads(content)
    if not isinstance(document, dict):
        raise ValueError("The SEC returned an unexpected document.")
    return document


def annual_observations(rows: Any) -> list[SecObservation]:
    periods: dict[date, SecObservation] = {}
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or row.get("form") not in {"10-K", "10-K/A"}:
            continue
        try:
            obs = SecObservation(
                start=row["start"],
                end=row["end"],
                filed=row["filed"],
                accession=row["accn"],
                value=row["val"],
                form=row["form"],
            )
        except (KeyError, ValidationError):
            continue
        if not (350 <= (obs.end - obs.start).days <= 380 and obs.end <= obs.filed):
            continue
        if abs(obs.value) > 2**53 - 1 or not math.isfinite(obs.value):
            continue
        prior = periods.get(obs.end)
        if not prior or (obs.filed, obs.accession) > (prior.filed, prior.accession):
            periods[obs.end] = obs
    return sorted(periods.values(), key=lambda obs: obs.end)[-5:]


async def lookup_sec_financials(
    request: SecLookup, *, transport: httpx.AsyncBaseTransport | None = None
) -> SecFinancials:
    receipt = SecFinancials(request=request, retrieved_at=datetime.now(UTC))
    tag = CONCEPTS[request.metric]
    agent = os.environ.get("RESEARCHCHAIN_SEC_USER_AGENT", "").strip()
    if not re.fullmatch(r"[\x20-\x7e]{3,200}", agent) or not re.search(r"\S+@\S+\.\S+", agent):
        receipt.detail = (
            "Set RESEARCHCHAIN_SEC_USER_AGENT to your organization and contact email on the worker."
        )
        return receipt
    try:
        async with (
            asyncio.timeout(15),
            httpx.AsyncClient(
                headers={"User-Agent": agent},
                follow_redirects=False,
                trust_env=False,
                timeout=6,
                transport=transport,
            ) as client,
        ):
            tickers = await _document(client, INDEX_URL)
            match = next(
                (
                    row
                    for row in tickers.values()
                    if isinstance(row, dict) and row.get("ticker") == request.ticker
                ),
                None,
            )
            if not match or not re.fullmatch(r"[0-9]{1,10}", str(match.get("cik_str", ""))):
                receipt.detail = f"No SEC ticker match for {request.ticker}."
                return receipt
            cik = str(match["cik_str"]).zfill(10)
            url = f"https://data.sec.gov/api/xbrl/companyconcept/CIK{cik}/us-gaap/{tag}.json"
            receipt.cik, receipt.source_url = cik, url
            # Leave room below EDGAR's ten requests/second fair-access limit.
            await asyncio.sleep(0.25)
            concept = await _document(client, url)
            if (
                str(concept.get("cik", "")).zfill(10) != cik
                or concept.get("tag") != tag
                or concept.get("taxonomy") != "us-gaap"
                or not isinstance(concept.get("units"), dict)
            ):
                receipt.detail = "SEC response did not identify the requested issuer and concept."
                return receipt
            receipt.issuer = str(concept.get("entityName") or match.get("title", ""))[:300]
            receipt.observations = annual_observations(concept["units"].get("USD"))
            if receipt.observations:
                receipt.status = "available"
            else:
                receipt.detail = "No annual USD observations in 10-K filings for this concept."
    except httpx.HTTPStatusError as error:
        receipt.detail = f"SEC lookup returned HTTP {error.response.status_code}."
    except (httpx.HTTPError, ValueError, TimeoutError):
        receipt.detail = "The SEC lookup could not retrieve a usable response."
    return receipt
