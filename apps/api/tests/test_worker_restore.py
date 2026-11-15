"""Restoring pending jobs requires review instead of automatic external replay."""

from pathlib import Path

import pytest
from psycopg.conninfo import make_conninfo
from test_dispatch import WorkerKilled, kill_worker, setup_queue

from researchchain.backup import create_backup
from researchchain.backup_restore import restore_backup
from researchchain.database import Database
from researchchain.dispatch import RunQueue
from researchchain.runtime import RunStore
from researchchain.worker import RunWorker


@pytest.mark.parametrize("claimed", [False, True])
def test_restored_worker_queue_waits_for_explicit_recovery(
    database: Database,
    workflow: dict,
    tmp_path: Path,
    restore_target: str,
    monkeypatch: pytest.MonkeyPatch,
    claimed: bool,
) -> None:
    queue, request = setup_queue(database, workflow)
    receipt = queue.start(request)
    if claimed:
        with monkeypatch.context() as patch:
            patch.setattr(RunStore, "_drive", kill_worker)
            with pytest.raises(WorkerKilled):
                RunWorker(queue.runs).run_once()
    directory = tmp_path / "queued-backup"
    create_backup(database, directory)
    restored_receipt = restore_backup(database, directory, restore_target, trusted=True)
    assert restored_receipt.held_commands == 1 and restored_receipt.provider_calls == 0
    restored = Database(make_conninfo(database.url, dbname=restore_target), database.schema)
    restored_runs = RunStore(restored)
    assert not RunWorker(restored_runs).run_once()
    held = restored_runs.get(request.id)
    assert held.status == "interrupted" and not held.events
    assert held.stop_reason and "requires review" in held.stop_reason
    assert RunQueue(restored_runs).start(request) == receipt
    assert not RunWorker(restored_runs).run_once()
    with database.connection() as conn:
        source = conn.execute("SELECT state FROM run_jobs").fetchone()
        assert source and source["state"] == ("running" if claimed else "queued")
    # Explicit recovery of this synthetic no-provider workflow is safe.
    RunQueue(restored_runs).recover(request.id)
    assert RunWorker(restored_runs).run_once()
    assert restored_runs.get(request.id).status == "paused"
