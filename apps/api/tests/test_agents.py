from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from typing import Any
from uuid import uuid4

from access_fixtures import owner_client
from fastapi.testclient import TestClient

from researchchain.agent_models import AgentCreate, AgentSave
from researchchain.agents import AgentStore
from researchchain.database import Database
from researchchain.main import create_app
from researchchain.models import RunRequest, Workflow
from researchchain.revisions import ConflictError
from researchchain.runtime import RunStore


def test_agents_have_distinct_identity_and_idempotent_creation(
    client: TestClient, workflow: dict[str, Any]
) -> None:
    request = {"id": str(uuid4()), "workflow": workflow}
    first = client.post("/api/agents", json=request)
    assert first.status_code == 201
    assert client.post("/api/agents", json=request).json() == first.json()
    second = client.post("/api/agents", json={**request, "id": str(uuid4())}).json()
    assert second["agent"]["id"] != first.json()["agent"]["id"]
    assert second["revision"]["id"] == first.json()["revision"]["id"]
    assert len(client.get("/api/agents").json()) == 2
    conflicting = deepcopy(request)
    conflicting["workflow"]["name"] = "Other creation"
    assert client.post("/api/agents", json=conflicting).status_code == 409
    assert client.get(f"/api/agents/{uuid4()}").status_code == 404


def test_agent_versions_revert_and_conflicts_preserve_pinned_documents(
    client: TestClient, workflow: dict[str, Any]
) -> None:
    created = client.post("/api/agents", json={"id": str(uuid4()), "workflow": workflow}).json()
    agent_id = created["agent"]["id"]
    path = f"/api/agents/{agent_id}/revisions"
    changed = deepcopy(workflow)
    changed["name"] = "Owner renamed this agent"
    update = {"expected_version": 1, "workflow": changed}
    saved = client.post(path, json=update)
    assert saved.status_code == 201
    assert saved.json()["agent"]["version"] == 2
    assert client.post(path, json=update).json() == saved.json()
    assert client.post(path, json={"expected_version": 1, "workflow": workflow}).status_code == 409
    reverted = client.post(path, json={"expected_version": 2, "workflow": workflow}).json()
    assert reverted["agent"]["version"] == 3
    assert reverted["revision"]["id"] == created["revision"]["id"]
    assert [item["version"] for item in client.get(path).json()] == [3, 2, 1]
    assert client.get(f"/api/revisions/{created['revision']['id']}").json() == created["revision"]
    # Replaying the original creation cannot roll back an existing agent.
    assert (
        client.post("/api/agents", json={"id": agent_id, "workflow": workflow}).json() == reverted
    )


def test_run_archive_filters_and_cursor_stay_in_scope(
    database: Database, workflow: dict[str, Any]
) -> None:
    with owner_client(create_app(database), workers=False) as client:
        first = client.post("/api/agents", json={"id": str(uuid4()), "workflow": workflow}).json()
        second = client.post("/api/agents", json={"id": str(uuid4()), "workflow": workflow}).json()
        agent_id = first["agent"]["id"]
        revision_id = first["revision"]["id"]

        def start(brief: str, agent: str | None = agent_id) -> str:
            run_id = str(uuid4())
            response = client.post(
                "/api/runs",
                json={"id": run_id, "agent_id": agent, "revision_id": revision_id, "brief": brief},
            )
            assert response.status_code == 202
            return run_id

        old = start("Compare inflation breakevens")
        recent = start("Inspect inflation swaps")
        unassigned = start("Inflation prints", None)
        start("Inflation surprise", second["agent"]["id"])
        cancelled = start("Inflation scenario")
        assert client.post(f"/api/runs/{cancelled}/cancel").status_code == 200
        filters = {"search": "INFLATION", "limit": "1", "agent_id": agent_id, "status": "queued"}

        page = client.get("/api/runs/search", params=filters).json()
        assert page["has_more"] is True
        row = page["items"][0]
        assert row["run"]["id"] == recent and row["brief_excerpt"] == "Inspect inflation swaps"
        start("Inflation futures")
        remaining = client.get(
            "/api/runs/search",
            params={**filters, "before_created_at": row["run"]["created_at"], "before_id": recent},
        ).json()
        assert remaining["has_more"] is False
        assert [item["run"]["id"] for item in remaining["items"]] == [old]
        legacy = client.get("/api/runs/search", params={"unassigned": "true"}).json()
        assert [item["run"]["id"] for item in legacy["items"]] == [unassigned]
        excluded = client.get("/api/runs/search", params={"search": old, "exclude_id": old}).json()
        assert excluded == {"items": [], "has_more": False}
        assert client.get("/api/runs/search", params={"before_id": recent}).status_code == 422


def test_concurrent_agent_saves_accept_one_version(
    database: Database, workflow: dict[str, Any]
) -> None:
    store = AgentStore(database)
    agent = store.create(AgentCreate(id=uuid4(), workflow=Workflow.model_validate(workflow))).agent

    def save(name: str) -> str:
        changed = {**workflow, "name": name}
        try:
            store.save(
                agent.id, AgentSave(expected_version=1, workflow=Workflow.model_validate(changed))
            )
            return "saved"
        except ConflictError:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(save, ["Version A", "Version B"])) == ["conflict", "saved"]
    assert store.get(agent.id).agent.version == 2
    assert len(store.versions(agent.id)) == 2


def test_runs_pin_exact_agent_even_when_revisions_are_shared(
    database: Database, workflow: dict[str, Any]
) -> None:
    store = AgentStore(database)
    a = store.create(AgentCreate(id=uuid4(), workflow=Workflow.model_validate(workflow)))
    b = store.create(AgentCreate(id=uuid4(), workflow=Workflow.model_validate(workflow)))
    runs = RunStore(database)
    request = RunRequest(
        id=uuid4(), agent_id=a.agent.id, revision_id=a.revision.id, brief="Owner test"
    )
    run = runs.start(request)
    assert run.agent_id == a.agent.id and run.agent_name == workflow["name"]
    assert runs.start(request).agent_id == a.agent.id
    assert [item.id for item in runs.list(agent_id=a.agent.id)] == [run.id]
    assert runs.list(agent_id=b.agent.id) == []
    try:
        runs.start(request.model_copy(update={"agent_id": b.agent.id}))
    except ConflictError:
        pass
    else:
        raise AssertionError("The same run must not change agents")
    changed = store.save(
        a.agent.id,
        AgentSave(
            expected_version=1, workflow=Workflow.model_validate({**workflow, "name": "New name"})
        ),
    )
    assert runs.get(run.id).agent_name == workflow["name"]
    try:
        runs.start(
            request.model_copy(
                update={"id": uuid4(), "agent_id": b.agent.id, "revision_id": changed.revision.id}
            )
        )
    except ConflictError:
        pass
    else:
        raise AssertionError("Cross-agent revision was accepted")
    legacy = runs.start(
        RunRequest(id=uuid4(), revision_id=a.revision.id, brief="Unassigned legacy run")
    )
    assert legacy.agent_id is None


def test_agent_endpoints_require_owner_access(database: Database) -> None:
    with TestClient(create_app(database), base_url="http://127.0.0.1:3000") as anonymous:
        assert anonymous.get("/api/agents").status_code == 401
        assert anonymous.get(f"/api/agents/{uuid4()}").status_code == 401
