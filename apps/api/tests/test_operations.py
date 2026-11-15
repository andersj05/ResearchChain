"""Synthetic database observations, worker lifecycle and content-free diagnostics."""

import json
import subprocess
import sys
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import uuid4

import psycopg
from access_fixtures import owner_client
from fastapi.testclient import TestClient
from run_fixtures import running_worker
from test_access_api import second_workspace
from test_dispatch import setup_queue
from test_worker_process import stalled_worker, worker_environment

from researchchain.artifacts import ArtifactStore
from researchchain.database import Database
from researchchain.dispatch import presence_key, slot_key
from researchchain.main import create_app
from researchchain.operations import OperationsStore, main
from researchchain.runtime import RunStore
from researchchain.worker import RunWorker

CANARY = "private-credentials-and-research-canary"


def eventually(check: Callable[[], bool]) -> None:
    deadline = time.monotonic() + 15
    while not check():
        assert time.monotonic() < deadline, "Worker observation did not settle."
        time.sleep(0.05)


def test_operations_empty_workspace_and_read_only_cli(database: Database, capsys) -> None:
    snapshot = OperationsStore(database).snapshot()
    assert snapshot.workers.connected_consumers == snapshot.workers.reserved_slots == 0
    assert snapshot.workers.max_parallel == 2 and snapshot.workers.max_pending == 100
    assert snapshot.queue.oldest_pending_seconds is None
    assert snapshot.queue.queued == snapshot.queue.executing == snapshot.queue.finished_24h == 0
    assert (
        snapshot.storage.runs == snapshot.storage.originals == snapshot.storage.original_bytes == 0
    )
    assert snapshot.storage.schema_bytes > 0
    assert snapshot.usage.attempts_started_24h == snapshot.usage.uncertain_attempts == 0
    assert (snapshot.observed_at - snapshot.window_started_at).total_seconds() == 86400
    assert main(database=database) == 0
    assert json.loads(capsys.readouterr().out)["queue"] == snapshot.queue.model_dump()


def test_operations_counts_usage_windows_and_omits_private_content(
    database: Database, workflow: dict
) -> None:
    queue, request = setup_queue(database, workflow)
    receipt = queue.start(request.model_copy(update={"brief": CANARY}))
    ArtifactStore(database).put(CANARY.encode(), CANARY + ".txt")
    with database.connection() as conn:
        for path, status, age, inputs, outputs in [
            ("old", "failed", 49, 99999, 99999),
            ("recent", "failed", 1, 12, 7),
            ("partial", "unknown", 2, 8, None),
            ("unfinished", "requesting", 0, None, None),
        ]:
            conn.execute(
                "INSERT INTO research_attempts "
                "(id, run_id, path, stage, model, status, created_at, input_tokens, "
                "output_tokens, reason, response_id) VALUES "
                "(%s, %s, %s, 'hypothesize', %s, %s, "
                "now() - %s * interval '1 hour', %s, %s, %s, %s)",
                (uuid4(), request.id, path, CANARY, status, age, inputs, outputs, CANARY, CANARY),
            )
        conn.execute(
            "UPDATE run_jobs SET last_error = %s, queued_at = now() - interval '2 minutes' "
            "WHERE command_id = %s",
            (CANARY, receipt.command_id),
        )
    snapshot = OperationsStore(database).snapshot()
    assert snapshot.storage.runs == snapshot.storage.originals == 1
    assert snapshot.storage.original_bytes == len(CANARY.encode())
    assert snapshot.queue.queued == 1 and snapshot.queue.oldest_pending_seconds >= 120
    assert snapshot.usage.model_dump() == {
        "attempts_started_24h": 3,
        "reported_input_tokens_24h": 20,
        "reported_output_tokens_24h": 7,
        "incomplete_usage_24h": 2,
        "uncertain_attempts": 2,
    }
    for private in [
        CANARY,
        str(request.id),
        str(receipt.command_id),
        database.schema,
        database.url,
    ]:
        assert private not in snapshot.model_dump_json()
    with database.connection() as conn:
        assert conn.execute("SELECT count(*) AS n FROM research_attempts").fetchone()["n"] == 4
        assert conn.execute("SELECT brief FROM runs").fetchone()["brief"] == CANARY


def test_run_reader_and_other_sessions_slot_do_not_count_as_execution(
    database: Database, workflow: dict
) -> None:
    queue, request = setup_queue(database, workflow)
    receipt = queue.start(request)
    with database.connection() as reader, database.connection() as other:
        reader.execute(
            "UPDATE run_jobs SET state = 'running', owner_id = %s WHERE command_id = %s",
            (uuid4(), receipt.command_id),
        )
        reader.execute("SELECT pg_advisory_lock(hashtextextended(%s, 0))", (f"run:{request.id}",))
        other.execute("SELECT pg_advisory_lock(hashtextextended(%s, 0))", (slot_key(database, 0),))
        status = OperationsStore(database).snapshot()
        assert status.workers.reserved_slots == 1
        assert status.queue.executing == 0 and status.queue.awaiting_takeover == 1
        other.execute("SELECT pg_advisory_unlock_all()")
        reader.execute("SELECT pg_advisory_lock(hashtextextended(%s, 0))", (slot_key(database, 0),))
        status = OperationsStore(database).snapshot()
        assert status.queue.executing == 1 and status.queue.awaiting_takeover == 0
    status = OperationsStore(database).snapshot()
    assert status.queue.executing == status.workers.reserved_slots == 0
    assert status.queue.awaiting_takeover == 1


def test_real_worker_loss_and_completion_are_observable(
    database: Database, workflow: dict, tmp_path
):
    queue, request = setup_queue(database, workflow)
    queue.start(request)
    with stalled_worker(database, tmp_path, "after_claim"):
        status = OperationsStore(database).snapshot()
        assert status.queue.executing == 1 and status.queue.awaiting_takeover == 0
    status = OperationsStore(database).snapshot()
    assert status.queue.executing == 0 and status.queue.awaiting_takeover == 1
    assert RunWorker(queue.runs).run_once()
    status = OperationsStore(database).snapshot()
    assert status.queue.finished_24h == 1 and status.queue.oldest_pending_seconds is None
    with database.connection() as conn:
        conn.execute("UPDATE run_jobs SET finished_at = now() - interval '25 hours'")
    assert OperationsStore(database).snapshot().queue.finished_24h == 0


def test_idle_worker_presence_is_workspace_scoped_and_released(database: Database) -> None:
    store = OperationsStore(database)
    with second_workspace(database) as other, running_worker(RunStore(database)):
        eventually(lambda: store.snapshot().workers.connected_consumers == 1)
        assert OperationsStore(other).snapshot().workers.connected_consumers == 0
        with running_worker(RunStore(database)):
            eventually(lambda: store.snapshot().workers.connected_consumers == 2)
        assert store.snapshot().workers.connected_consumers == 1
    assert store.snapshot().workers.connected_consumers == 0


def test_worker_presence_reconnects_without_reusing_execution_session(database: Database) -> None:
    def presence_pids():
        with database.connection() as conn:
            return {
                r["pid"]
                for r in conn.execute(
                    "SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND granted "
                    "AND objsubid = 1 AND mode = 'ShareLock' "
                    "AND ((classid::bigint << 32) | objid::bigint) = hashtextextended(%s, 0)",
                    (presence_key(database),),
                )
            }

    with running_worker(RunStore(database)):
        eventually(lambda: bool(presence_pids()))
        original = presence_pids()
        with database.connection() as conn:
            for pid in original:
                conn.execute("SELECT pg_terminate_backend(%s)", (pid,))
        eventually(lambda: bool(presence_pids()) and not presence_pids().intersection(original))
    assert not presence_pids()


def test_serving_process_death_removes_presence(database: Database) -> None:
    process = subprocess.Popen(
        [sys.executable, "-m", "researchchain.worker"],
        env=worker_environment(database),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        eventually(lambda: OperationsStore(database).snapshot().workers.connected_consumers == 2)
    finally:
        process.kill()
        process.wait(timeout=10)
    eventually(lambda: OperationsStore(database).snapshot().workers.connected_consumers == 0)


def test_presence_does_not_change_active_model_execution(database: Database) -> None:
    from test_research_runtime import setup_run

    from researchchain.dispatch import RunQueue

    runs, request, provider = setup_run(database)
    RunQueue(runs).start(request)
    provider.block = True
    stop = Event()
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(RunWorker(runs).serve, stop, 0.02)
        try:
            assert provider.started.wait(5)
            status = OperationsStore(database).snapshot()
            assert status.workers.connected_consumers == status.queue.executing == 1
            assert status.usage.uncertain_attempts == 0
            assert status.usage.incomplete_usage_24h == 1
            assert len(provider.calls) == 1
        finally:
            stop.set()
            provider.released.set()
        future.result(timeout=10)
    assert OperationsStore(database).snapshot().workers.connected_consumers == 0
    assert len(provider.calls) == 1


def test_database_outage_logs_once_without_private_exception(
    database: Database, monkeypatch, caplog
) -> None:
    worker = RunWorker(RunStore(database))
    stop = Event()
    attempts = 0

    def fail():
        nonlocal attempts
        attempts += 1
        if attempts == 3:
            stop.set()
        raise psycopg.OperationalError(CANARY)

    monkeypatch.setattr(worker, "run_once", fail)
    worker.serve(stop, 0.001)
    assert attempts == 3
    warnings = [r for r in caplog.records if r.name == "researchchain.worker"]
    assert len(warnings) == 1 and CANARY not in caplog.text
    assert OperationsStore(database).snapshot().workers.connected_consumers == 0


def test_operations_require_owner_and_redact_database_failures(database: Database, monkeypatch):
    app = create_app(database)
    with TestClient(app, base_url=app.state.access.config.origin) as anonymous:
        assert anonymous.get("/api/operations").status_code == 401
    with owner_client(app, workers=False) as owner:
        response = owner.get("/api/operations")
        assert response.status_code == 200 and "no-store" in response.headers["cache-control"]
        assert response.json()["workers"]["connected_consumers"] == 0

        def fail(_):
            raise psycopg.OperationalError(CANARY)

        monkeypatch.setattr(OperationsStore, "snapshot", fail)
        response = owner.get("/api/operations")
        assert response.status_code == 503 and CANARY not in response.text


def test_operations_cli_redacts_setup_failures(database: Database, monkeypatch, capsys):
    def fail(_):
        raise RuntimeError(CANARY)

    monkeypatch.setattr(Database, "ready", fail)
    assert main(database=database) == 1
    assert capsys.readouterr().out == (
        "Operations unavailable. Check database availability and migrations.\n"
    )


def test_interrupted_commands_and_old_uncertainty_remain_visible(
    database: Database, workflow: dict
):
    queue, request = setup_queue(database, workflow)
    receipt = queue.start(request)
    with database.connection() as conn:
        conn.execute(
            "UPDATE run_jobs SET state = 'interrupted', last_error = %s WHERE command_id = %s",
            (CANARY, receipt.command_id),
        )
        conn.execute(
            "INSERT INTO research_attempts (id, run_id, path, stage, model, status, created_at) "
            "VALUES (%s, %s, 'lost', 'hypothesize', %s, 'unknown', now() - interval '48 hours')",
            (uuid4(), request.id, CANARY),
        )
    snapshot = OperationsStore(database).snapshot()
    assert snapshot.queue.interrupted == snapshot.usage.uncertain_attempts == 1
    assert snapshot.queue.oldest_pending_seconds is None
    assert snapshot.usage.attempts_started_24h == 0
    assert CANARY not in snapshot.model_dump_json()
