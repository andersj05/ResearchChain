import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from researchchain.main import create_app
from researchchain.models import RunRequest, Workflow
from researchchain.runtime import RunStore


@pytest.fixture
def workflow() -> dict[str, Any]:
    path = Path(__file__).resolve().parents[3] / "examples/research-workflow.json"
    return json.loads(path.read_text(encoding="utf-8"))  # type: ignore[no-any-return]


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def test_review_uses_real_checkpoint_and_original_workflow(
    client: TestClient, workflow: dict[str, Any]
) -> None:
    response = client.post("/api/runs", json={"workflow": workflow, "brief": "Test a hypothesis"})
    assert response.status_code == 201
    paused = response.json()
    assert paused["status"] == "paused"
    assert [event["node_id"] for event in paused["events"]] == ["frame", "challenge"]
    assert paused["review"]["node_id"] == "review"
    workflow["nodes"][0]["instructions"] = "Changed after the run started"
    resumed = client.post(f"/api/runs/{paused['id']}/resume", json={"decision": "approve"})
    assert resumed.status_code == 200
    result = resumed.json()
    assert result["status"] == "completed"
    assert result["workflow"]["nodes"][0]["instructions"] != workflow["nodes"][0]["instructions"]
    assert [event["node_id"] for event in result["events"]] == [
        "frame",
        "challenge",
        "review",
        "finish",
    ]
    assert (
        client.post(f"/api/runs/{paused['id']}/resume", json={"decision": "approve"}).status_code
        == 409
    )


def test_rejection_stops_before_finish(client: TestClient, workflow: dict[str, Any]) -> None:
    run = client.post("/api/runs", json={"workflow": workflow, "brief": "A question"}).json()
    response = client.post(f"/api/runs/{run['id']}/resume", json={"decision": "reject"})
    assert response.json()["status"] == "rejected"
    assert "finish" not in [event["node_id"] for event in response.json()["events"]]


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


def test_multiple_reviews_resume_at_each_checkpoint(
    client: TestClient, workflow: dict[str, Any]
) -> None:
    workflow["nodes"][1]["kind"] = "review"
    run = client.post("/api/runs", json={"workflow": workflow, "brief": "A question"}).json()
    assert run["review"]["node_id"] == "challenge"
    second = client.post(f"/api/runs/{run['id']}/resume", json={"decision": "approve"}).json()
    assert second["status"] == "paused"
    assert second["review"]["node_id"] == "review"
    assert len(second["events"]) == 2


def test_local_store_is_bounded_and_runs_are_isolated(workflow: dict[str, Any]) -> None:
    store = RunStore(capacity=2)
    request = RunRequest(workflow=Workflow.model_validate(workflow), brief="First")
    first = store.start(request)
    request.brief = "Second"
    second = store.start(request)
    store.resume(first.id, "approve")
    assert store.get(second.id).status == "paused"
    assert store.get(first.id).brief == "First"
    with pytest.raises(OverflowError):
        store.start(request)


def test_api_validation_and_missing_run(client: TestClient, workflow: dict[str, Any]) -> None:
    assert client.post("/api/workflows/validate", json=workflow).json()["valid"] is True
    workflow["edges"] = []
    assert client.post("/api/workflows/validate", json=workflow).status_code == 422
    assert client.get("/api/runs/missing").status_code == 404
    assert client.post("/api/runs/missing/resume", json={"decision": "approve"}).status_code == 404
