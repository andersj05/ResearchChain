from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
from time import sleep
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from graph_fixtures import chain, nested, node, split
from run_fixtures import run_request
from test_durability import decision, start
from test_restart import api_process

from researchchain import compiler
from researchchain.controls import ACTIVE_TIME_LIMIT_REASON, ExecutionControl, control_state
from researchchain.database import Database
from researchchain.graph import ExecutionBudgets, Workflow
from researchchain.models import RunRequest
from researchchain.revisions import RevisionStore
from researchchain.runtime import RunStore


@pytest.mark.parametrize(
    "document", [split(), split("route"), nested(), nested("loop", until=True)]
)
def test_advanced_api_runs_are_durable(client: TestClient, document: dict) -> None:
    result = start(client, document)
    assert result["status"] == "completed"
    assert result["compiler_version"] == "structured-0.2.0"
    assert result["events"][-1]["path"] == "root/finish"
    assert result["usage"]["node_executions"] > 0
    assert client.get(f"/api/runs/{result['id']}").json() == result


def test_node_budget_is_global_across_parallel_branches_and_recovery(client: TestClient) -> None:
    document = split()
    document["budgets"] = {"max_node_executions": 2, "max_concurrency": 4}
    result = start(client, document)
    assert result["status"] == "limited"
    assert result["stop_reason"] == "Node execution limit reached."
    assert result["usage"]["node_executions"] == 2
    assert result["checkpoint_steps"]
    assert all(
        step["status"] == "stopped" and step["path"] in {"root/left", "root/right"}
        for step in result["checkpoint_steps"]
    )
    assert all(event["path"] != "root/finish" for event in result["events"])
    assert run_request(client, f"/api/runs/{result['id']}/recover").json() == result


def test_loop_exhaustion_is_a_durable_terminal_outcome(client: TestClient) -> None:
    document = nested("loop", until=True)
    document["nodes"][0]["config"]["until"]["value"] = 100
    result = start(client, document)
    assert result["status"] == "limited" and "exhausted 3" in result["stop_reason"]
    assert result["checkpoint_steps"] == [{"path": "root/nested", "status": "stopped"}]
    assert run_request(client, f"/api/runs/{result['id']}/recover").json() == result


def test_cancellation_is_idempotent_and_cannot_resume(client: TestClient) -> None:
    paused = start(client, nested(review=True))
    path = f"/api/runs/{paused['id']}"
    inbox = "/api/runs/reviews?limit=1"
    later = start(client, nested(review=True))
    first_page = client.get(inbox).json()
    assert first_page["has_more"] is True
    assert first_page["items"][0]["id"] == paused["id"]
    second_page = client.get(f"{inbox}&offset=1").json()
    assert second_page["has_more"] is False
    assert second_page["items"][0]["id"] == later["id"]
    first = client.post(f"{path}/cancel")
    assert first.json()["status"] == "cancelled"
    assert client.post(f"{path}/cancel").json() == first.json()
    cancelled = client.get(path).json()
    assert cancelled["status"] == "cancelled" and not cancelled["reviews"]
    assert client.get(inbox).json() == second_page
    assert run_request(client, f"{path}/resume", json=decision(paused)).status_code == 409
    assert run_request(client, f"{path}/recover").json() == cancelled


def test_cancel_does_not_rewrite_a_completed_result(client: TestClient) -> None:
    completed = start(client, split())
    assert client.post(f"/api/runs/{completed['id']}/cancel").json()["status"] == "completed"
    assert client.get(f"/api/runs/{completed['id']}").json() == completed


def test_cancellation_reaches_an_executing_worker_without_its_lock(
    database: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    entered, release = Event(), Event()
    original = compiler.node_function

    def instrument(node: Any, *args: Any) -> Any:
        execute = original(node, *args)

        def wait(state: Any) -> Any:
            if node.id == "slow":
                entered.set()
                assert release.wait(5)
            return execute(state)

        return wait

    monkeypatch.setattr(compiler, "node_function", instrument)
    document = chain(node("slow"), node("finish", "finish"))
    revision = RevisionStore(database).save(Workflow.model_validate(document))
    request = RunRequest(id=uuid4(), revision_id=revision.id, brief="Cancel in flight")
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(RunStore(database).start, request)
        try:
            assert entered.wait(5)
            assert RunStore(database).list()[0].status == "running"
            progress = RunStore(database).get(request.id)
            assert [(step.path, step.status) for step in progress.checkpoint_steps] == [
                ("root/slow", "scheduled")
            ]
            assert not future.done()
            assert RunStore(database).cancel(request.id).status == "cancelled"
        finally:
            release.set()
        result = future.result(timeout=5)
    assert result.status == "cancelled"
    assert not result.events


@pytest.mark.parametrize("concurrency", [1, 2])
def test_configured_concurrency_is_enforced(
    database: Database, monkeypatch: pytest.MonkeyPatch, concurrency: int
) -> None:
    active = peak = 0
    lock = Lock()
    original = compiler.node_function

    def instrument(node: Any, *args: Any) -> Any:
        execute = original(node, *args)

        def measured(state: Any) -> Any:
            nonlocal active, peak
            if node.kind != "note":
                return execute(state)
            with lock:
                active += 1
                peak = max(peak, active)
            try:
                sleep(0.05)
                return execute(state)
            finally:
                with lock:
                    active -= 1

        return measured

    monkeypatch.setattr(compiler, "node_function", instrument)
    document = split()
    document["budgets"] = {"max_concurrency": concurrency}
    revision = RevisionStore(database).save(Workflow.model_validate(document))
    result = RunStore(database).start(
        RunRequest(id=uuid4(), revision_id=revision.id, brief="Parallel")
    )
    assert result.status == "completed"
    assert peak == concurrency


def test_time_budget_does_not_reset_after_review_or_store_restart(
    database: Database, client: TestClient
) -> None:
    paused = start(client, nested(review=True))
    with database.connection() as conn:
        conn.execute(
            "UPDATE run_controls SET active_seconds = 120 WHERE run_id = %s", (paused["id"],)
        )
    result = run_request(client, f"/api/runs/{paused['id']}/resume", json=decision(paused)).json()
    assert result["status"] == "limited" and "time limit" in result["stop_reason"]
    assert RunStore(database).recover(UUID(paused["id"])).status == "limited"


def test_clock_rollback_preserves_charged_time_at_a_checkpoint(
    database: Database, client: TestClient
) -> None:
    run_id = UUID(start(client, nested(review=True))["id"])
    rollback = (
        "UPDATE run_controls SET active_seconds = 5, "
        "active_started_at = clock_timestamp() + interval '1 hour' WHERE run_id = %s"
    )
    with database.connection() as conn:
        control = ExecutionControl(conn, run_id, ExecutionBudgets(max_active_seconds=5), Lock())
        conn.execute(rollback, (run_id,))
        assert control_state(conn, run_id)["active_seconds"] == 5
        with pytest.raises(compiler.ExecutionStopped, match=ACTIVE_TIME_LIMIT_REASON):
            control.guard("", False)
        control.end()
        assert control_state(conn, run_id)["active_seconds"] == 5

        conn.execute(rollback, (run_id,))
        with pytest.raises(compiler.ExecutionStopped, match=ACTIVE_TIME_LIMIT_REASON):
            control.begin()
        assert conn.execute(
            "SELECT active_seconds FROM run_controls WHERE run_id = %s", (run_id,)
        ).fetchone() == {"active_seconds": 5}


def test_parallel_reviews_are_individually_addressed(client: TestClient) -> None:
    document = split()
    document["nodes"][1]["kind"] = document["nodes"][2]["kind"] = "review"
    paused = start(client, document)
    assert len(paused["reviews"]) == 2
    second = paused["reviews"][1]
    response = run_request(
        client,
        f"/api/runs/{paused['id']}/resume",
        json={
            "checkpoint_id": paused["checkpoint_id"],
            "interrupt_id": second["interrupt_id"],
            "decision": "approve",
        },
    )
    assert response.status_code == 200, response.text
    remaining = response.json()
    assert len(remaining["reviews"]) == 1
    assert remaining["review"]["interrupt_id"] == paused["reviews"][0]["interrupt_id"]
    completed = run_request(
        client, f"/api/runs/{paused['id']}/resume", json=decision(remaining)
    ).json()
    assert completed["status"] == "completed"


def test_nested_review_survives_hard_restart_with_pinned_definition(database: Database) -> None:
    document = nested("loop", review=True)
    with api_process(database) as first:
        revision = first.post("/api/revisions", json=document).json()
        paused = run_request(
            first,
            "/api/runs",
            json={"id": str(uuid4()), "revision_id": revision["id"], "brief": "Nested restart"},
        ).json()
        assert paused["review"]["path"] == "root/nested/iteration-1/inside"
        document["subgraphs"][0]["nodes"][0]["instructions"] = "A changed question"
        assert first.post("/api/revisions", json=document).json()["id"] != revision["id"]
    with api_process(database) as second:
        assert second.get(f"/api/runs/{paused['id']}").json() == paused
        previous = paused
        for iteration in range(1, 4):
            assert previous["review"]["path"] == f"root/nested/iteration-{iteration}/inside"
            assert previous["review"]["question"] != "A changed question"
            request = decision(previous)
            next_run = run_request(second, f"/api/runs/{paused['id']}/resume", json=request).json()
            assert (
                run_request(second, f"/api/runs/{paused['id']}/resume", json=request).json()
                == next_run
            )
            previous = next_run
        assert previous["status"] == "completed"
        # One claim per logical invocation, including reviews replayed on approval.
        assert previous["usage"]["node_executions"] == 11


def test_registry_and_openapi_keep_typed_workflow_contracts(client: TestClient) -> None:
    response = client.get("/api/node-types")
    assert response.status_code == 200
    registry = {item["kind"]: item for item in response.json()}
    assert set(registry) == {
        "note",
        "review",
        "finish",
        "route",
        "fork",
        "join",
        "loop",
        "subgraph",
        "research",
        "code",
    }
    assert {"name": "text", "type": "text"} in registry["note"]["outputs"]
    assert "max_iterations" in registry["loop"]["config_schema"]["properties"]
    assert {"name": "number", "type": "number"} in registry["code"]["outputs"]
    assert {"name": "text", "type": "text"} in registry["code"]["inputs"]
    code = registry["code"]["config_schema"]["properties"]
    assert code["language"]["const"] == "javascript"
    assert code["timeout_seconds"]["maximum"] == 5
    schemas = client.get("/api/openapi.json").json()["components"]["schemas"]
    assert "nodes" in schemas["Workflow"]["properties"]
    assert "Workflow-Output" not in schemas


def test_budget_queries_cannot_overlap_checkpoint_pipeline_contexts(
    database: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    from contextlib import contextmanager

    from langgraph.checkpoint.postgres import PostgresSaver
    from psycopg import Connection

    pipeline_connections: set[int] = set()
    original_cursor = PostgresSaver._cursor
    original_execute = Connection.execute

    @contextmanager
    def delayed_cursor(saver: Any, **kwargs: Any) -> Any:
        with original_cursor(saver, **kwargs) as cursor:
            pipeline_connections.add(id(saver.conn))
            try:
                # Make concurrent branch guards overlap background checkpoint IO
                # deterministically unless they share the saver's connection lock.
                sleep(0.01)
                yield cursor
            finally:
                pipeline_connections.remove(id(saver.conn))

    def checked_execute(connection: Any, query: Any, *args: Any, **kwargs: Any) -> Any:
        if isinstance(query, str) and query.startswith("SELECT terminal_status"):
            assert id(connection) not in pipeline_connections, "budget query raced checkpoint IO"
        return original_execute(connection, query, *args, **kwargs)

    monkeypatch.setattr(PostgresSaver, "_cursor", delayed_cursor)
    monkeypatch.setattr(Connection, "execute", checked_execute)
    revision = RevisionStore(database).save(Workflow.model_validate(split()))
    result = RunStore(database).start(
        RunRequest(id=uuid4(), revision_id=revision.id, brief="Shared IO")
    )
    assert result.status == "completed"


def test_history_never_recompiles_saved_graphs(
    client: TestClient, database: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    completed = start(client, split())

    def forbidden(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("history must not compile or lock a run")

    monkeypatch.setattr(RunStore, "_graph", forbidden)
    summary = RunStore(database).list()[0]
    assert summary.id == UUID(completed["id"])
    assert summary.status == "completed"
