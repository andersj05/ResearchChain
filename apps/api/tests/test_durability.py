from concurrent.futures import ThreadPoolExecutor
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from langgraph.checkpoint.postgres import PostgresSaver
from psycopg import IntegrityError

from researchchain.database import Database
from researchchain.main import create_app
from researchchain.models import ResumeRequest, RunRequest, Workflow
from researchchain.revisions import ConflictError, RevisionStore
from researchchain.runtime import RunStore


def start(client: TestClient, workflow: dict[str, Any], **extra: Any) -> dict[str, Any]:
    revision = client.post("/api/revisions", json=workflow)
    assert revision.status_code == 201, revision.text
    request = {
        "id": str(uuid4()),
        "revision_id": revision.json()["id"],
        "brief": "Test a hypothesis",
        **extra,
    }
    response = client.post("/api/runs", json=request)
    assert response.status_code == 201, response.text
    return response.json()  # type: ignore[no-any-return]


def decision(run: dict[str, Any], value: str = "approve") -> dict[str, str]:
    return {
        "checkpoint_id": run["checkpoint_id"],
        "interrupt_id": run["review"]["interrupt_id"],
        "decision": value,
    }


def test_pinned_revision_repeat_resume_and_conflict(
    client: TestClient, workflow: dict[str, Any]
) -> None:
    paused = start(client, workflow)
    assert paused["status"] == "paused"
    assert [event["node_id"] for event in paused["events"]] == ["frame", "challenge"]
    workflow["nodes"][0]["instructions"] = "Changed after the run started"
    newer = client.post("/api/revisions", json=workflow).json()
    assert newer["id"] != paused["revision_id"]
    path = f"/api/runs/{paused['id']}/resume"
    resumed = client.post(path, json=decision(paused))
    assert resumed.status_code == 200, resumed.text
    result = resumed.json()
    assert result["status"] == "completed"
    assert result["workflow"]["nodes"][0]["instructions"] != workflow["nodes"][0]["instructions"]
    assert [event["node_id"] for event in result["events"]] == [
        "frame",
        "challenge",
        "review",
        "finish",
    ]
    assert client.post(path, json=decision(paused)).json() == result
    assert client.post(path, json=decision(paused, "reject")).status_code == 409
    assert client.get(f"/api/runs/{paused['id']}").json() == result


def test_rejection_and_run_isolation(client: TestClient, workflow: dict[str, Any]) -> None:
    first = start(client, workflow)
    second = start(client, workflow, brief="Independent run")
    rejected = client.post(f"/api/runs/{first['id']}/resume", json=decision(first, "reject")).json()
    assert rejected["status"] == "rejected"
    assert "finish" not in [event["node_id"] for event in rejected["events"]]
    assert client.get(f"/api/runs/{second['id']}").json()["status"] == "paused"
    assert len(client.get("/api/runs").json()) == 2


def test_concurrent_workers_cannot_approve_the_next_review(
    database: Database, client: TestClient, workflow: dict[str, Any]
) -> None:
    workflow["nodes"][1]["kind"] = "review"
    first = start(client, workflow)
    assert first["review"]["node_id"] == "challenge"
    with TestClient(create_app(database)) as other, ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(worker.post, f"/api/runs/{first['id']}/resume", json=decision(first))
            for worker in (client, other)
        ]
        results = [future.result() for future in futures]
    assert [result.status_code for result in results] == [200, 200]
    assert results[0].json() == results[1].json()
    second = results[0].json()
    assert second["status"] == "paused" and second["review"]["node_id"] == "review"
    assert len(second["events"]) == 2
    assert client.post(f"/api/runs/{first['id']}/resume", json=decision(first)).json() == second
    assert client.get(f"/api/runs/{first['id']}").json() == second
    stale = {**decision(second), "checkpoint_id": first["checkpoint_id"]}
    assert client.post(f"/api/runs/{first['id']}/resume", json=stale).status_code == 409
    finished = client.post(f"/api/runs/{first['id']}/resume", json=decision(second))
    assert finished.json()["status"] == "completed"


def test_start_retry_and_revision_deduplication(
    client: TestClient, workflow: dict[str, Any]
) -> None:
    run_id = str(uuid4())
    first = start(client, workflow, id=run_id)
    assert start(client, workflow, id=run_id) == first
    assert len(client.get("/api/revisions").json()) == 1
    assert len(client.get("/api/runs").json()) == 1
    response = client.post(
        "/api/runs", json={"id": run_id, "revision_id": first["revision_id"], "brief": "Changed"}
    )
    assert response.status_code == 409


def test_database_rejects_revision_and_manifest_mutation(
    database: Database, client: TestClient, workflow: dict[str, Any]
) -> None:
    run = start(client, workflow)
    with database.connection() as conn:
        with pytest.raises(IntegrityError, match="immutable"):
            conn.execute(
                "UPDATE workflow_revisions SET workflow = '{}' WHERE id = %s", (run["revision_id"],)
            )
        with pytest.raises(IntegrityError, match="immutable"):
            conn.execute("UPDATE runs SET brief = 'mutated' WHERE id = %s", (run["id"],))
        with pytest.raises(IntegrityError, match="immutable"):
            conn.execute("DELETE FROM runs WHERE id = %s", (run["id"],))


@pytest.mark.parametrize("kind", ["start", "resume"])
def test_crash_after_checkpoint_before_receipt_does_not_advance_again(
    database: Database, workflow: dict[str, Any], monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    workflow["nodes"][1]["kind"] = "review"
    revision = RevisionStore(database).save(Workflow.model_validate(workflow))
    request = RunRequest(id=uuid4(), revision_id=revision.id, brief="Crash window")
    store = RunStore(database)
    first = store.start(request) if kind == "resume" else None

    def fail_receipt(*args: Any) -> None:
        raise RuntimeError("simulated process failure after durable checkpoint")

    with monkeypatch.context() as patch:
        patch.setattr(store, "_complete_command", fail_receipt)
        with pytest.raises(RuntimeError, match="simulated"):
            if first:
                store.resume(
                    first.id, ResumeRequest.model_validate(decision(first.model_dump(mode="json")))
                )
            else:
                store.start(request)

    restarted = RunStore(database)
    assert restarted.get(request.id).status == "interrupted"
    recovered = restarted.recover(request.id)
    assert recovered.status == "paused" and recovered.review is not None
    assert recovered.review.node_id == ("review" if kind == "resume" else "challenge")
    assert len(recovered.events) == (2 if kind == "resume" else 1)
    assert restarted.recover(request.id) == recovered


def test_crash_before_first_checkpoint_can_recover_manifest(
    database: Database, workflow: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    revision = RevisionStore(database).save(Workflow.model_validate(workflow))
    request = RunRequest(id=uuid4(), revision_id=revision.id, brief="Before invoke")
    store = RunStore(database)

    def fail_drive(*args: Any) -> None:
        raise RuntimeError("simulated pre-invoke crash")

    monkeypatch.setattr(store, "_drive", fail_drive)
    with pytest.raises(RuntimeError, match="pre-invoke"):
        store.start(request)
    restarted = RunStore(database)
    assert restarted.get(request.id).status == "interrupted"
    assert restarted.recover(request.id).status == "paused"


def test_crash_between_nodes_recovers_saved_progress(
    database: Database, workflow: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    from researchchain import runtime

    revision = RevisionStore(database).save(Workflow.model_validate(workflow))
    request = RunRequest(id=uuid4(), revision_id=revision.id, brief="Mid-execution crash")
    original = runtime._node_function

    def failing_node(node: Any) -> Any:
        def fail(state: Any) -> Any:
            raise RuntimeError("simulated node crash")

        return fail if node.id == "challenge" else original(node)

    with monkeypatch.context() as patch:
        patch.setattr(runtime, "_node_function", failing_node)
        with pytest.raises(RuntimeError, match="node crash"):
            RunStore(database).start(request)
    restored = RunStore(database)
    assert [event.node_id for event in restored.get(request.id).events] == ["frame"]
    recovered = restored.recover(request.id)
    assert recovered.status == "paused"
    assert [event.node_id for event in recovered.events] == ["frame", "challenge"]


def test_checkpoint_only_contains_artifact_addresses(
    database: Database, client: TestClient, workflow: dict[str, Any]
) -> None:
    artifact = {"id": "sha256:" + "a" * 64, "name": "Synthetic chart", "media_type": "image/png"}
    run = start(client, workflow, artifacts=[artifact])
    assert run["artifacts"] == [artifact]
    with database.connection() as conn:
        saved = PostgresSaver(conn).get_tuple({"configurable": {"thread_id": run["id"]}})
        assert saved is not None
        values = saved.checkpoint["channel_values"]
        assert values["artifact_ids"] == [artifact["id"]]
        assert "artifacts" not in values


def test_crash_after_resume_writes_before_node_completion(
    database: Database, workflow: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    from researchchain import runtime

    workflow["nodes"][1]["kind"] = "review"
    revision = RevisionStore(database).save(Workflow.model_validate(workflow))
    store = RunStore(database)
    first = store.start(RunRequest(id=uuid4(), revision_id=revision.id, brief="Resume write crash"))
    request = ResumeRequest.model_validate(decision(first.model_dump(mode="json")))
    original = runtime._node_function

    def failing_review(node: Any) -> Any:
        execute = original(node)

        def fail_after_interrupt(state: Any) -> Any:
            execute(state)
            raise RuntimeError("simulated crash after accepting decision")

        return fail_after_interrupt if node.id == "challenge" else execute

    with monkeypatch.context() as patch:
        patch.setattr(runtime, "_node_function", failing_review)
        with pytest.raises(RuntimeError, match="accepting decision"):
            store.resume(first.id, request)
    restarted = RunStore(database)
    recovered = restarted.recover(first.id)
    assert recovered.status == "paused" and recovered.review is not None
    assert recovered.review.node_id == "review"
    assert [event.node_id for event in recovered.events] == ["frame", "challenge"]
    assert restarted.resume(first.id, request) == recovered


def test_migrations_are_repeatable_and_verify_checksums(
    database: Database, client: TestClient
) -> None:
    database.migrate()
    assert client.get("/api/health").json()["database"] == "ready"
    with database.connection() as conn:
        conn.execute("UPDATE schema_migrations SET checksum = 'changed'")
    assert client.get("/api/health").status_code == 503
    with pytest.raises(RuntimeError, match="differ"):
        database.migrate()


def test_incompatible_compiler_is_not_silently_used(
    database: Database,
    client: TestClient,
    workflow: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run = start(client, workflow)
    monkeypatch.setattr("researchchain.runtime.COMPILER_VERSION", "future-incompatible")
    with pytest.raises(ConflictError, match="compatible compiler"):
        RunStore(database).recover(UUID(run["id"]))
