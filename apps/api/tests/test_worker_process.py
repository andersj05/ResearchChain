"""Hard process death exercises actual Postgres lock release and durable takeover."""

import os
import subprocess
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from test_dispatch import setup_queue

from researchchain.database import Database
from researchchain.dispatch_models import QueueLimits
from researchchain.runtime import RunStore
from researchchain.worker import RunWorker


def worker_environment(database: Database) -> dict[str, str]:
    assert database.schema.startswith("test_") and len(database.schema) == 37
    return {
        **os.environ,
        "DATABASE_URL": database.url,
        "DATABASE_SCHEMA": database.schema,
    }


@contextmanager
def stalled_worker(database: Database, directory: Path, phase: str) -> Iterator[None]:
    ready = directory / "worker-ready.txt"
    process = subprocess.Popen(
        [
            sys.executable,
            str(Path(__file__).with_name("worker_process_fixture.py")),
            "--phase",
            phase,
            "--ready-file",
            str(ready),
        ],
        env=worker_environment(database),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    try:
        deadline = time.monotonic() + 20
        while not ready.exists():
            if process.poll() is not None:
                raise AssertionError("Synthetic worker exited before its checkpoint.")
            if time.monotonic() >= deadline:
                raise AssertionError("Synthetic worker did not reach its checkpoint.")
            time.sleep(0.05)
        yield
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=10)
        if process.stderr:
            process.stderr.close()


def work_in_new_process(database: Database) -> None:
    result = subprocess.run(
        [sys.executable, "-m", "researchchain.worker", "--once"],
        env=worker_environment(database),
        stdin=subprocess.DEVNULL,
        capture_output=True,
        timeout=20,
        check=False,
    )
    assert result.returncode == 0, "Synthetic replacement worker did not finish."


@pytest.mark.parametrize("phase", ["before_claim", "after_claim", "after_command"])
def test_hard_process_death_keeps_command_durable(
    database: Database, workflow: dict, tmp_path: Path, phase: str
) -> None:
    queue, request = setup_queue(database, workflow)
    queue.start(request)
    with stalled_worker(database, tmp_path, phase):
        # Another worker cannot steal the live process's run.
        assert not RunWorker(RunStore(database)).run_once()
    work_in_new_process(database)
    paused = queue.runs.get(request.id)
    assert paused.status == "paused"
    assert [event.node_id for event in paused.events] == ["frame", "challenge"]
    work_in_new_process(database)
    assert queue.runs.get(request.id) == paused
    with database.connection() as conn:
        job = conn.execute("SELECT state, attempts FROM run_jobs").fetchone()
        assert job == {"state": "finished", "attempts": 2 if phase == "after_claim" else 1}


def test_workspace_concurrency_limit_applies_across_processes(
    database: Database, workflow: dict, tmp_path: Path
) -> None:
    from uuid import uuid4

    queue, request = setup_queue(database, workflow)
    queue.configure(QueueLimits(max_parallel=1))
    queue.start(request)
    other = request.model_copy(update={"id": uuid4()})
    queue.start(other)
    with stalled_worker(database, tmp_path, "after_claim"):
        work_in_new_process(database)
        assert queue.runs.get(other.id).status == "queued"
    work_in_new_process(database)
    assert queue.runs.get(request.id).status == "paused"
    work_in_new_process(database)
    assert queue.runs.get(other.id).status == "paused"


def test_api_process_restarts_preserve_queued_and_worker_owned_commands(
    database: Database, workflow: dict, tmp_path: Path
) -> None:
    from test_restart import api_process

    queue, request = setup_queue(database, workflow)
    with api_process(database, workers=False) as first:
        accepted = first.post("/api/runs", json=request.model_dump(mode="json"))
        assert accepted.status_code == 202
        receipt = accepted.json()
    # An independent worker acquires the command after the first API has died.
    with stalled_worker(database, tmp_path, "after_claim"):
        for _ in range(2):
            with api_process(database, workers=False) as restarted:
                assert restarted.get(f"/api/runs/{request.id}").json()["status"] == "running"
                assert (
                    restarted.post("/api/runs", json=request.model_dump(mode="json")).json()
                    == receipt
                )
        assert not RunWorker(queue.runs).run_once()
    work_in_new_process(database)
    assert queue.runs.get(request.id).status == "paused"
