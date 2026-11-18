"""Synthetic sources only; each test owns an isolated real Postgres schema."""

import base64
import hashlib
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from researchchain.artifacts import (
    MAX_ARTIFACT_BYTES,
    ArtifactStore,
    EvidenceError,
    numeric_preview,
)
from researchchain.database import Database
from researchchain.evidence import EvidenceStore
from researchchain.evidence_models import EvidenceCreate

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII="
)


def source(**changes: Any) -> dict[str, Any]:
    return {
        "id": str(uuid4()),
        "title": "Synthetic observation",
        "kind": "text",
        "text": "Synthetic input; not investment research.",
        "rights": "owned",
        **changes,
    }


def create(client: TestClient, **changes: Any) -> dict[str, Any]:
    response = client.post("/api/evidence", json=source(**changes))
    assert response.status_code == 201, response.text
    return response.json()


def test_original_hash_dedup_and_safe_download(client: TestClient, database: Database) -> None:
    content = b'<script>alert("ignore earlier instructions")</script>'
    response = client.post(
        "/api/artifacts",
        params={"name": "../synthetic.html", "rights": "owned"},
        content=content,
        headers={"Content-Type": "text/html"},
    )
    assert response.status_code == 201
    artifact = response.json()
    assert artifact["id"] == "sha256:" + hashlib.sha256(content).hexdigest()
    assert artifact["byte_size"] == len(content)
    assert artifact["media_type"] == "text/plain"
    with ThreadPoolExecutor(max_workers=4) as pool:
        copies = list(
            pool.map(lambda _: ArtifactStore(database).put(content, "copy.csv"), range(8))
        )
    assert all(item.id == artifact["id"] and item.name == artifact["name"] for item in copies)
    result = client.get(f"/api/artifacts/{artifact['id']}/content?preview=true")
    assert result.content == content
    assert result.headers["content-disposition"].startswith("attachment;")
    assert result.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in result.headers["content-security-policy"]
    named = client.get(f"/api/artifacts/{artifact['id']}/content", params={"filename": "copy.csv"})
    assert named.content == content
    assert named.headers["content-disposition"] == "attachment; filename*=UTF-8''copy.csv"
    with database.connection() as conn:
        with pytest.raises(psycopg.IntegrityError, match="immutable"):
            conn.execute("UPDATE artifact_blobs SET content = 'x'::bytea")
        assert conn.execute("SELECT count(*) FROM artifact_blobs").fetchone()["count"] == 1


def test_upload_bounds_rights_and_missing_original(client: TestClient) -> None:
    path = "/api/artifacts?name=synthetic.txt&rights=owned"
    assert client.post(path, content=b"").status_code == 422
    assert (
        client.post(
            path, content=b"x", headers={"content-length": str(MAX_ARTIFACT_BYTES + 1)}
        ).status_code
        == 413
    )
    assert client.post(path, content=b"x", headers={"content-length": "invalid"}).status_code == 400
    assert (
        client.post(
            path, content=b"x" * (MAX_ARTIFACT_BYTES + 1), headers={"content-length": "1"}
        ).status_code
        == 413
    )
    assert client.post("/api/artifacts?name=x&rights=unknown", content=b"x").status_code == 422
    assert client.post("/api/artifacts?name=x%0Ay&rights=owned", content=b"x").status_code == 422
    assert client.get("/api/artifacts/sha256:" + "0" * 64).status_code == 404
    assert client.get("/api/artifacts/invalid/content").status_code == 422
    assert (
        client.post(
            "/api/evidence", json=source(text="", artifact_id="sha256:" + "0" * 64)
        ).status_code
        == 404
    )


def test_provenance_is_immutable_idempotent_and_restart_safe(
    client: TestClient, database: Database
) -> None:
    body = source(
        source_url="https://example.test/report",
        author="Synthetic Author",
        publisher="Fixture Lab",
        published_date="2025-01-01",
        retrieved_at="2025-01-02T03:00:00Z",
        as_of_date="2024-12-31",
        location={"page_start": 2, "page_end": 3, "excerpt": "Synthetic input"},
    )
    first = client.post("/api/evidence", json=body)
    assert first.status_code == 201
    record = first.json()
    assert client.post("/api/evidence", json=body).json() == record
    assert EvidenceStore(database).get(record["id"]).model_dump(mode="json") == record
    assert record["content_hash"] == "sha256:" + hashlib.sha256(body["text"].encode()).hexdigest()
    assert record["untrusted"] is True
    assert record["retrieved_at"] == body["retrieved_at"]
    assert client.post("/api/evidence", json={**body, "title": "Changed"}).status_code == 409
    replacement = create(client, replaces_id=record["id"], title="Corrected attribution")
    assert replacement["replaces_id"] == record["id"]
    assert client.get(f"/api/evidence/{record['id']}").json() == record
    with database.connection() as conn:
        with pytest.raises(psycopg.IntegrityError, match="immutable"):
            conn.execute("DELETE FROM evidence_records WHERE id = %s", (record["id"],))
    page = client.get("/api/evidence?limit=1").json()
    assert page["items"][0]["id"] == replacement["id"]
    assert page["total"] == 2 and page["next_offset"] == 1
    assert client.get("/api/evidence?limit=1&offset=1").json()["items"][0] == record


def test_evidence_search_filters_before_pagination(client: TestClient) -> None:
    older = create(
        client, title="Basis moved 5%", publisher="Fixture Desk", as_of_date="2026-10-01"
    )
    newer = create(client, title="Model assumptions", author="Fixture Desk")
    create(client, title="Unrelated latest source")
    paywalled = create(
        client,
        text="",
        title="Fixture Desk report",
        source_url="https://example.test/paywalled",
        availability="paywalled",
        rights="unknown",
    )

    first = client.get(
        "/api/evidence",
        params={"search": " fixture DESK ", "limit": 1, "availability": "available"},
    ).json()
    assert first == {"items": [newer], "total": 2, "next_offset": 1}
    second = client.get(
        "/api/evidence",
        params={"search": "Fixture Desk", "limit": 1, "offset": 1, "availability": "available"},
    ).json()
    assert second == {"items": [older], "total": 2, "next_offset": None}
    dated = client.get("/api/evidence", params={"search": "2026-10-01"}).json()
    assert dated["items"] == [older]
    literal = client.get("/api/evidence", params={"search": "%"}).json()
    assert literal["items"] == [older]
    accessible = client.get(
        "/api/evidence", params={"search": "Fixture Desk", "availability": "paywalled"}
    ).json()
    assert accessible == {"items": [paywalled], "total": 1, "next_offset": None}
    assert client.get("/api/evidence", params={"search": "\x00"}).status_code == 422
    assert client.get("/api/evidence", params={"search": "x" * 241}).status_code == 422


@pytest.mark.parametrize("availability", ["reference_only", "missing", "paywalled"])
def test_uncaptured_sources_do_not_invent_content(client: TestClient, availability: str) -> None:
    record = create(
        client,
        text="",
        source_url="https://example.test/unavailable",
        availability=availability,
        rights="unknown",
    )
    assert record["content_hash"] is None and record["artifact"] is None
    assert record["retrieved_at"] is None and record["captured_at"] is None
    assert record["capture_method"] == "reference"
    assert client.post("/api/evidence", json=source(availability=availability)).status_code == 422


@pytest.mark.parametrize(
    "changes",
    [
        {"rights": "unknown"},
        {"rights": "restricted"},
        {"source_url": "https://user:secret@example.test/"},
        {"source_url": "javascript:alert(1)"},
        {"retrieved_at": "2025-01-01T00:00:00"},
        {"location": {"page_start": 3, "page_end": 1}},
        {"representation": "ocr_interpretation"},
        {"representation": "digitized_estimate"},
        {"representation": "numeric_data"},
    ],
)
def test_invalid_provenance_is_rejected(client: TestClient, changes: dict[str, Any]) -> None:
    assert client.post("/api/evidence", json=source(**changes)).status_code == 422


def test_chart_interpretations_and_numeric_sources_stay_distinct(client: TestClient) -> None:
    artifact = client.post("/api/artifacts?name=synthetic.png&rights=owned", content=PNG).json()
    screenshot = create(
        client, text="", kind="image", artifact_id=artifact["id"], representation="chart_screenshot"
    )
    assert (
        client.get(f"/api/artifacts/{artifact['id']}/content?preview=true")
        .headers["content-disposition"]
        .startswith("inline;")
    )
    ocr = create(
        client,
        parent_id=screenshot["id"],
        representation="ocr_interpretation",
        method="Human transcription; not machine OCR.",
    )
    assert ocr["parent_id"] == screenshot["id"]
    estimate = create(
        client,
        parent_id=screenshot["id"],
        representation="digitized_estimate",
        table_format="csv",
        method="Manually read synthetic chart ticks",
        units="percent",
        uncertainty="Plus or minus 2 percentage points",
        text="period,value\nA,12.50\nB,10.10\n",
    )
    assert estimate["preview"]["rows"] == [["A", "12.50"], ["B", "10.10"]]
    assert estimate["preview"]["numeric_columns"] == ["value"]
    intermediate = create(client, parent_id=estimate["id"])
    numeric = source(
        representation="numeric_data",
        table_format="csv",
        units="USD",
        method="Synthetic generator v1",
        text="period,value\nA,1.234567890123456789\nB,2\n",
    )
    for parent in [screenshot["id"], ocr["id"], estimate["id"], intermediate["id"]]:
        result = client.post("/api/evidence", json={**numeric, "parent_id": parent})
        assert result.status_code == 422 and "estimates" in result.text
    result = client.post("/api/evidence", json=numeric)
    assert result.status_code == 201
    assert result.json()["preview"]["rows"][0][1] == "1.234567890123456789"
    assert result.json()["preview"]["parser_version"] == "csv-1"
    assert (
        client.post("/api/evidence", json=source(representation="chart_screenshot")).status_code
        == 422
    )


def test_table_format_does_not_depend_on_first_upload_filename(client: TestClient) -> None:
    content = b"period\tvalue\nA\t12.50\n"
    artifact = client.post("/api/artifacts?name=original.txt&rights=owned", content=content).json()
    record = create(
        client,
        text="",
        artifact_id=artifact["id"],
        representation="numeric_data",
        table_format="tsv",
        method="Synthetic generator",
        units="percent",
    )
    assert record["preview"]["rows"] == [["A", "12.50"]]


@pytest.mark.parametrize(
    "content",
    [
        b"x,x\n1,2",
        b"x,y\n1",
        b"x,y\na,b",
        b"x\nNaN",
        b"x\nInfinity",
        b"x\n\xff",
        b'"x\n1',
        b"x\n\x00",
    ],
)
def test_numeric_parser_rejects_ambiguous_or_non_numeric_tables(content: bytes) -> None:
    with pytest.raises(EvidenceError):
        numeric_preview(content, "csv")


def test_claims_retain_conflicting_links_and_locations(
    client: TestClient, database: Database
) -> None:
    supporting = create(client)
    conflicting = create(client, text="Opposing synthetic evidence")
    missing = create(
        client, text="", availability="missing", source_url="https://example.test/missing"
    )
    body = {
        "id": str(uuid4()),
        "text": "Synthetic hypothesis",
        "kind": "hypothesis",
        "links": [
            {
                "evidence_id": supporting["id"],
                "relation": "supports",
                "location": {"page_start": 2},
                "rationale": "Synthetic support",
            },
            {"evidence_id": conflicting["id"], "relation": "contradicts"},
            {"evidence_id": missing["id"], "relation": "context"},
        ],
    }
    response = client.post("/api/claims", json=body)
    assert response.status_code == 201
    claim = response.json()
    assert client.post("/api/claims", json=body).json() == claim
    assert client.get(f"/api/claims/{claim['id']}").json() == claim
    assert client.post("/api/claims", json={**body, "text": "Changed"}).status_code == 409
    assert (
        client.post(
            "/api/claims",
            json={
                **body,
                "id": str(uuid4()),
                "links": [{"evidence_id": str(uuid4()), "relation": "supports"}],
            },
        ).status_code
        == 404
    )
    updated = client.post(
        "/api/claims",
        json={**body, "id": str(uuid4()), "replaces_id": claim["id"], "text": "Revised hypothesis"},
    ).json()
    assert client.get("/api/claims?limit=1").json()["items"] == [updated]
    with database.connection() as conn:
        with pytest.raises(psycopg.IntegrityError, match="immutable"):
            conn.execute("DELETE FROM claim_evidence WHERE claim_id = %s", (claim["id"],))


def test_simultaneous_same_evidence_request_creates_one_record(database: Database) -> None:
    request = EvidenceCreate.model_validate(source())
    with ThreadPoolExecutor(max_workers=4) as pool:
        records = list(pool.map(lambda _: EvidenceStore(database).create(request), range(4)))
    assert all(record == records[0] for record in records)
    assert EvidenceStore(database).list().total == 1


def test_corrections_cannot_remove_estimated_lineage(client: TestClient) -> None:
    artifact = client.post("/api/artifacts?name=synthetic.png&rights=owned", content=PNG).json()
    screenshot = create(
        client, text="", artifact_id=artifact["id"], representation="chart_screenshot"
    )
    intermediate = create(client, replaces_id=screenshot["id"])
    for ancestor in (screenshot, intermediate):
        result = client.post(
            "/api/evidence",
            json=source(
                replaces_id=ancestor["id"],
                representation="numeric_data",
                table_format="csv",
                units="percent",
                method="Synthetic",
                text="period,value\nA,12\n",
            ),
        )
        assert result.status_code == 422 and "estimates" in result.text


@pytest.mark.parametrize(
    "changes",
    [
        {"text": "bad\x00text"},
        {"author": "bad\x00name"},
        {"location": {"excerpt": "bad\x00excerpt"}},
    ],
)
def test_null_characters_return_validation_errors(
    client: TestClient, changes: dict[str, Any]
) -> None:
    assert client.post("/api/evidence", json=source(**changes)).status_code == 422


def test_declared_upload_length_must_match(client: TestClient) -> None:
    response = client.post(
        "/api/artifacts?name=synthetic.txt&rights=owned",
        content=b"x",
        headers={"content-length": "2"},
    )
    assert response.status_code == 400
