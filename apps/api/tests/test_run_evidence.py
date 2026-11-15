from typing import Any
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from researchchain.database import Database


def test_runs_pin_evidence_and_keep_unavailable_sources_explicit(
    client: TestClient, workflow: dict[str, Any], database: Database
) -> None:
    first = client.post(
        "/api/evidence",
        json={
            "id": str(uuid4()),
            "title": "Synthetic source",
            "kind": "text",
            "text": "Original synthetic observation",
            "rights": "owned",
        },
    ).json()
    missing = client.post(
        "/api/evidence",
        json={
            "id": str(uuid4()),
            "title": "Unavailable source",
            "kind": "link",
            "availability": "paywalled",
            "source_url": "https://example.test/paywall",
        },
    ).json()
    revision = client.post("/api/revisions", json=workflow).json()
    request = {
        "id": str(uuid4()),
        "revision_id": revision["id"],
        "brief": "Synthetic test",
        "evidence_ids": [first["id"], missing["id"]],
    }
    response = client.post("/api/runs", json=request)
    assert response.status_code == 201, response.text
    run = response.json()
    assert run["evidence_ids"] == request["evidence_ids"]
    assert len(run["artifacts"]) == 1 and run["artifacts"][0]["id"] == first["content_hash"]
    newer = client.post(
        "/api/evidence",
        json={
            "id": str(uuid4()),
            "title": "Corrected synthetic source",
            "kind": "text",
            "text": "New version",
            "rights": "owned",
            "replaces_id": first["id"],
        },
    ).json()
    assert client.get(f"/api/runs/{run['id']}").json()["evidence_ids"] == request["evidence_ids"]
    assert client.post("/api/runs", json=request).json() == run
    assert (
        client.post("/api/runs", json={**request, "evidence_ids": [newer["id"]]}).status_code == 409
    )
    with database.connection() as conn:
        with pytest.raises(psycopg.IntegrityError, match="immutable"):
            conn.execute("DELETE FROM run_evidence WHERE run_id = %s", (run["id"],))


def test_new_runs_reject_unknown_or_mismatched_inputs(
    client: TestClient, workflow: dict[str, Any]
) -> None:
    revision = client.post("/api/revisions", json=workflow).json()
    request = {"id": str(uuid4()), "revision_id": revision["id"], "brief": "Synthetic test"}
    artifact = {"id": "sha256:" + "a" * 64, "media_type": "text/plain", "name": "Absent"}
    assert client.post("/api/runs", json={**request, "artifacts": [artifact]}).status_code == 404
    unknown = str(uuid4())
    assert client.post("/api/runs", json={**request, "evidence_ids": [unknown]}).status_code == 404
    assert (
        client.post("/api/runs", json={**request, "evidence_ids": [unknown, unknown]}).status_code
        == 422
    )
    uploaded = client.post(
        "/api/artifacts?name=synthetic.txt&rights=owned", content=b"Synthetic"
    ).json()
    artifact["id"] = uploaded["id"]
    assert client.post("/api/runs", json={**request, "artifacts": [artifact]}).status_code == 422
    assert client.get(f"/api/runs/{request['id']}").status_code == 404


def test_accepted_legacy_run_and_receipt_survive_availability_validation(
    client: TestClient, workflow: dict[str, Any], database: Database
) -> None:
    revision = client.post("/api/revisions", json=workflow).json()
    artifact = {"id": "sha256:" + "a" * 64, "media_type": "image/png", "name": "Legacy address"}
    request = {
        "id": str(uuid4()),
        "revision_id": revision["id"],
        "brief": "Legacy accepted manifest",
        "artifacts": [artifact],
    }
    # Seed the exact pre-ingestion manifest/journal shape, without a blob or associations.
    with database.connection() as conn, conn.transaction():
        conn.execute(
            "INSERT INTO runs (id, revision_id, compiler_version, brief, artifacts) "
            "VALUES (%s, %s, 'chain-0.1.0', %s, %s)",
            (request["id"], revision["id"], request["brief"], Jsonb([artifact])),
        )
        conn.execute("INSERT INTO run_controls (run_id) VALUES (%s)", (request["id"],))
        conn.execute(
            "INSERT INTO run_commands (id, run_id, kind) VALUES (%s, %s, 'start')",
            (uuid4(), request["id"]),
        )
    response = client.post("/api/runs", json=request)
    assert response.status_code == 201, response.text
    run = response.json()
    assert run["artifacts"] == [artifact] and run["evidence_ids"] == []
    with database.connection() as conn:
        conn.execute(
            "UPDATE run_commands SET response = response - 'evidence_ids' WHERE run_id = %s",
            (request["id"],),
        )
    assert client.post("/api/runs", json=request).json() == run
    assert client.get(f"/api/runs/{run['id']}").json()["artifacts"] == [artifact]
