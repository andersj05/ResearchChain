"""Real Postgres admission, competing workers and safe journal recovery."""

from concurrent.futures import ThreadPoolExecutor
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from test_research_runtime import approve, setup_run

from researchchain.database import Database
from researchchain.dispatch import RunQueue
from researchchain.dispatch_models import DispatchError, QueueLimits
from researchchain.models import RunRequest, Workflow
from researchchain.research import ResearchExecutor
from researchchain.revisions import ConflictError, RevisionStore
from researchchain.runtime import RunStore
from researchchain.worker import RunWorker


class WorkerKilled(BaseException):
    """Simulate process death without the worker's ordinary exception handler."""


def kill_worker(*args: Any, **kwargs: Any) -> None:
    raise WorkerKilled()


def setup_queue(database: Database, workflow: dict) -> tuple[RunQueue, RunRequest]:
    revision = RevisionStore(database).save(Workflow.model_validate(workflow))
    return RunQueue(RunStore(database)), RunRequest(
        id=uuid4(), revision_id=revision.id, brief="Synthetic queued research"
    )


def test_admission_commits_before_execution_and_retries_keep_receipt(
    database: Database, workflow: dict
) -> None:
    queue, request = setup_queue(database, workflow)
    receipt = queue.start(request)
    queued = queue.runs.get(request.id)
    assert queued.status == "queued" and not queued.events and not queued.reviews
    assert queue.runs.list()[0].status == "queued"
    assert queue.start(request) == receipt
    worker = RunWorker(RunStore(database))
    assert worker.run_once()
    paused = queue.runs.get(request.id)
    assert paused.status == "paused" and len(paused.events) == 2
    assert queue.start(request) == receipt
    assert not worker.run_once()
    assert queue.runs.get(request.id) == paused


def test_full_queue_rolls_back_new_run_and_cancellation_releases_capacity(
    database: Database, workflow: dict
) -> None:
    queue, first = setup_queue(database, workflow)
    queue.configure(QueueLimits(max_parallel=1, max_pending=1))
    receipt = queue.start(first)
    second = first.model_copy(update={"id": uuid4()})
    with pytest.raises(DispatchError, match="full"):
        queue.start(second)
    with database.connection() as conn:
        assert conn.execute("SELECT 1 FROM runs WHERE id = %s", (second.id,)).fetchone() is None
    assert queue.start(first) == receipt
    with pytest.raises(DispatchError, match="pending"):
        queue.configure(QueueLimits())
    queue.runs.cancel(first.id)
    queue.start(second)
    worker = RunWorker(queue.runs)
    assert worker.run_once()
    assert queue.runs.get(first.id).status == "cancelled"
    assert not queue.runs.get(first.id).events
    assert worker.run_once()
    assert queue.runs.get(second.id).status == "paused"


def test_duplicate_and_recovery_return_while_provider_is_busy(database: Database) -> None:
    runs, request, provider = setup_run(database)
    queue = RunQueue(runs)
    receipt = queue.start(request)
    provider.block = True
    with ThreadPoolExecutor(max_workers=2) as executor:
        work = executor.submit(RunWorker(runs).run_once)
        try:
            assert provider.started.wait(5)
            duplicate = executor.submit(queue.start, request)
            assert duplicate.result(timeout=3) == receipt
            assert executor.submit(queue.recover, request.id).result(timeout=3) == receipt
            assert not work.done()
            assert runs.get(request.id).status == "running"
            with pytest.raises(ConflictError, match="different inputs"):
                queue.start(request.model_copy(update={"brief": "Different request"}))
            assert len(provider.calls) == 1
        finally:
            provider.released.set()
        assert work.result(timeout=5)
    assert runs.get(request.id).status == "paused"


def test_two_workers_contend_without_duplicate_inference(database: Database) -> None:
    runs, request, provider = setup_run(database)
    RunQueue(runs).start(request)
    provider.block = True
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(RunWorker(runs).run_once)
        try:
            assert provider.started.wait(5)
            assert executor.submit(RunWorker(runs).run_once).result(timeout=3) is False
            assert len(provider.calls) == 1 and not first.done()
        finally:
            provider.released.set()
        assert first.result(timeout=5)


def test_workspace_slots_bound_independent_workers(database: Database) -> None:
    runs, request, provider = setup_run(database)
    queue = RunQueue(runs)
    queue.configure(QueueLimits(max_parallel=1))
    queue.start(request)
    next_request = request.model_copy(update={"id": uuid4()})
    queue.start(next_request)
    provider.block = True
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(RunWorker(runs).run_once)
        try:
            assert provider.started.wait(5)
            assert executor.submit(RunWorker(runs).run_once).result(timeout=3) is False
            assert runs.get(next_request.id).status == "queued"
            assert len(provider.calls) == 1
            with pytest.raises(DispatchError, match="active workers"):
                queue.configure(QueueLimits())
        finally:
            provider.released.set()
        assert first.result(timeout=5)
    assert RunWorker(runs).run_once()
    assert len(provider.calls) == 2


def test_exact_review_is_admitted_once_and_rejected_if_changed(database: Database) -> None:
    runs, request, provider = setup_run(database)
    queue = RunQueue(runs)
    queue.start(request)
    worker = RunWorker(runs)
    worker.run_once()
    first = runs.get(request.id)
    review = approve(first, "Synthetic review")
    receipt = queue.resume(request.id, review)
    assert runs.get(request.id).status == "queued"
    assert not runs.get(request.id).reviews
    assert queue.resume(request.id, review) == receipt
    with pytest.raises(ConflictError, match="different recorded"):
        queue.resume(request.id, review.model_copy(update={"feedback": "Changed review"}))
    worker.run_once()
    second = runs.get(request.id)
    assert second.status == "paused" and second.checkpoint_id != first.checkpoint_id
    assert queue.resume(request.id, review) == receipt
    assert not worker.run_once()
    assert len(provider.calls) == 3
    assert runs.get(request.id) == second


def test_rejected_queue_admission_does_not_record_review(database: Database) -> None:
    runs, request, _ = setup_run(database)
    queue = RunQueue(runs)
    queue.configure(QueueLimits(max_pending=1))
    queue.start(request)
    RunWorker(runs).run_once()
    paused = runs.get(request.id)
    queue.start(request.model_copy(update={"id": uuid4()}))
    with pytest.raises(DispatchError, match="full"):
        queue.resume(request.id, approve(paused))
    assert runs.get(request.id) == paused
    with database.connection() as conn:
        count = conn.execute(
            "SELECT count(*) AS n FROM run_commands WHERE run_id = %s", (request.id,)
        ).fetchone()
        assert count and count["n"] == 1


def test_worker_startup_does_not_resume_legacy_or_interrupted_commands(
    database: Database, workflow: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    queue, request = setup_queue(database, workflow)
    with monkeypatch.context() as patch:
        patch.setattr(RunStore, "_complete_command", kill_worker)
        with pytest.raises(WorkerKilled):
            queue.runs.start(request)
    assert queue.runs.get(request.id).status == "interrupted"
    worker = RunWorker(queue.runs)
    assert not worker.run_once()
    # Retrying the original request remains a receipt lookup, not a recovery.
    queue.start(request)
    assert not worker.run_once()
    queue.recover(request.id)
    assert worker.run_once()
    assert queue.runs.get(request.id).status == "paused"


@pytest.mark.parametrize("point", ["checkpoint", "completed_effect"])
def test_abandoned_ownership_reuses_confirmed_work(
    database: Database, monkeypatch: pytest.MonkeyPatch, point: str
) -> None:
    runs, request, provider = setup_run(database)
    RunQueue(runs).start(request)
    with monkeypatch.context() as patch:
        if point == "checkpoint":
            patch.setattr(RunStore, "_complete_command", kill_worker)
        else:
            finish = ResearchExecutor.finish

            def finish_then_die(*args: Any, **kwargs: Any) -> None:
                finish(*args, **kwargs)
                raise WorkerKilled()

            patch.setattr(ResearchExecutor, "finish", finish_then_die)
        with pytest.raises(WorkerKilled):
            RunWorker(runs).run_once()
    assert RunWorker(runs).run_once()
    assert runs.get(request.id).status == "paused"
    assert len(provider.calls) == 1
    with database.connection() as conn:
        row = conn.execute("SELECT attempts, state FROM run_jobs").fetchone()
        assert row == {"attempts": 2, "state": "finished"}


def test_abandoned_uncertain_effect_is_fenced_before_any_new_inference(
    database: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    runs, request, provider = setup_run(database)
    RunQueue(runs).start(request)
    provider.crash = True
    with monkeypatch.context() as patch:
        patch.setattr(RunWorker, "_interrupt", kill_worker)
        with pytest.raises(WorkerKilled):
            RunWorker(runs).run_once()
    provider.crash = False
    assert RunWorker(runs).run_once()
    failed = runs.get(request.id)
    assert failed.status == "failed"
    assert failed.model_attempts[0].status == "unknown"
    assert failed.stop_reason and "will not be resent" in failed.stop_reason
    assert len(provider.calls) == 1


def test_known_worker_error_requires_explicit_recovery_and_redacts_details(
    database: Database,
) -> None:
    runs, request, provider = setup_run(database)
    queue = RunQueue(runs)
    receipt = queue.start(request)
    provider.crash = True
    worker = RunWorker(runs)
    assert worker.run_once()
    interrupted = runs.get(request.id)
    assert interrupted.status == "interrupted"
    assert interrupted.stop_reason and "Simulated" not in interrupted.stop_reason
    assert queue.start(request) == receipt
    assert not worker.run_once()
    queue.recover(request.id)
    assert worker.run_once()
    assert runs.get(request.id).status == "failed" and len(provider.calls) == 1


def test_repeated_hard_crashes_stop_automatic_recovery(
    database: Database, workflow: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    queue, request = setup_queue(database, workflow)
    queue.start(request)
    with monkeypatch.context() as patch:
        patch.setattr(RunStore, "_drive", kill_worker)
        for _ in range(3):
            with pytest.raises(WorkerKilled):
                RunWorker(queue.runs).run_once()
    assert not RunWorker(queue.runs).run_once()
    interrupted = queue.runs.get(request.id)
    assert interrupted.status == "interrupted"
    assert interrupted.stop_reason and "repeatedly" in interrupted.stop_reason
    queue.recover(request.id)
    assert RunWorker(queue.runs).run_once()
    assert queue.runs.get(request.id).status == "paused"


def test_database_disconnect_fences_old_worker_and_cancels_inflight_provider(
    database: Database,
) -> None:
    runs, request, provider = setup_run(database)
    RunQueue(runs).start(request)
    provider.block = True
    with ThreadPoolExecutor(max_workers=1) as executor:
        old_worker = executor.submit(RunWorker(runs).run_once)
        try:
            assert provider.started.wait(5)
            with database.connection() as conn:
                row = conn.execute(
                    "SELECT pg_terminate_backend(pid) AS terminated FROM pg_locks "
                    "WHERE locktype = 'advisory' AND granted AND objsubid = 1 "
                    "AND database = (SELECT oid FROM pg_database "
                    "WHERE datname = current_database()) "
                    "AND classid::bigint = ((hashtextextended(%s, 0) >> 32) & 4294967295) "
                    "AND objid::bigint = (hashtextextended(%s, 0) & 4294967295)",
                    (f"run:{request.id}", f"run:{request.id}"),
                ).fetchone()
                assert row and row["terminated"]
            assert RunWorker(runs).run_once()
            with pytest.raises(psycopg.Error):
                old_worker.result(timeout=5)
            assert provider.cancelled.wait(5)
        finally:
            provider.released.set()
    assert runs.get(request.id).status == "failed"
    assert len(provider.calls) == 1
