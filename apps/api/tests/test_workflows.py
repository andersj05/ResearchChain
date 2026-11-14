from copy import deepcopy
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from researchchain.models import ArtifactRef, Workflow


@pytest.mark.parametrize("case", ["duplicate", "dangling", "cycle", "branch", "version", "code"])
def test_invalid_workflow_is_rejected_before_execution(workflow: dict[str, Any], case: str) -> None:
    candidate = deepcopy(workflow)
    if case == "duplicate":
        candidate["nodes"][1]["id"] = "frame"
    elif case == "dangling":
        candidate["edges"][0]["target"] = "missing"
    elif case == "cycle":
        candidate["edges"][1]["target"] = "frame"
    elif case == "branch":
        candidate["edges"].append({"source": "frame", "target": "review"})
    elif case == "version":
        candidate["schema_version"] = "9.0"
    else:
        candidate["nodes"][0]["code"] = "untrusted Python"
    with pytest.raises(ValidationError):
        Workflow.model_validate(candidate)


def test_disconnected_cycle_cannot_hide_behind_valid_finish(workflow: dict[str, Any]) -> None:
    workflow["nodes"] += [
        {"id": "a", "kind": "note", "label": "A", "position": {"x": 0, "y": 0}},
        {"id": "b", "kind": "note", "label": "B", "position": {"x": 0, "y": 0}},
    ]
    workflow["edges"] += [{"source": "a", "target": "b"}, {"source": "b", "target": "a"}]
    with pytest.raises(ValidationError, match="reachable"):
        Workflow.model_validate(workflow)


def test_api_validation_and_missing_run(client: TestClient, workflow: dict[str, Any]) -> None:
    assert client.post("/api/workflows/validate", json=workflow).json()["valid"] is True
    workflow["edges"] = []
    assert client.post("/api/revisions", json=workflow).status_code == 422
    assert client.get(f"/api/runs/{uuid4()}").status_code == 404
    assert client.get("/api/runs/not-a-uuid").status_code == 422
    assert client.get("/api/runs?limit=1000").status_code == 422


def test_artifact_content_cannot_be_embedded() -> None:
    with pytest.raises(ValidationError):
        ArtifactRef.model_validate(
            {
                "id": "sha256:" + "a" * 64,
                "name": "Report",
                "media_type": "application/pdf",
                "body": "bytes",
            }
        )
    with pytest.raises(ValidationError):
        ArtifactRef(
            id="https://unverified.example/report.pdf", name="Report", media_type="application/pdf"
        )
