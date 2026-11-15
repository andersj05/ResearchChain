"""Atomic command admission; no graph execution in HTTP requests."""

from collections.abc import Iterator
from contextlib import contextmanager
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from researchchain.database import Database
from researchchain.dispatch_models import CommandReceipt, DispatchError, QueueLimits
from researchchain.models import ResumeRequest, RunRequest
from researchchain.revisions import ConflictError
from researchchain.runtime import RunStore


def receipt(command: DictRow) -> CommandReceipt:
    return CommandReceipt(
        command_id=command["id"],
        run_id=command["run_id"],
        kind=command["kind"],
        accepted_at=command["created_at"],
    )


def queue_limits(conn: Connection[DictRow]) -> QueueLimits:
    row = conn.execute("SELECT max_parallel, max_pending FROM run_queue_limits").fetchone()
    if row is None:
        raise RuntimeError("Worker configuration is missing. Check database migrations.")
    return QueueLimits.model_validate(row)


def slot_key(database: Database, slot: int) -> str:
    return f"worker:{database.schema}:{slot}"


class RunQueue:
    def __init__(self, runs: RunStore) -> None:
        self.runs = runs
        self.database = runs.database

    @contextmanager
    def _admission(self) -> Iterator[Connection[DictRow]]:
        with self.database.connection() as conn, conn.transaction():
            row = conn.execute(
                "SELECT pg_try_advisory_xact_lock(hashtextextended(%s, 0)) AS acquired",
                (f"admission:{self.database.schema}",),
            ).fetchone()
            assert row
            if not row["acquired"]:
                raise DispatchError("Command admission is busy. Retry the same request.")
            yield conn

    @staticmethod
    def _own_run(conn: Connection[DictRow], run_id: UUID) -> bool:
        row = conn.execute(
            "SELECT pg_try_advisory_xact_lock(hashtextextended(%s, 0)) AS acquired",
            (f"run:{run_id}",),
        ).fetchone()
        assert row
        return bool(row["acquired"])

    @staticmethod
    def _enqueue(conn: Connection[DictRow], command: DictRow) -> None:
        limits = queue_limits(conn)
        row = conn.execute(
            "SELECT count(*) AS pending FROM run_jobs j "
            "JOIN run_commands c ON c.id = j.command_id "
            "JOIN run_controls controls ON controls.run_id = c.run_id "
            "WHERE j.state IN ('queued', 'running') AND c.response IS NULL "
            "AND controls.terminal_status IS NULL AND j.command_id <> %s",
            (command["id"],),
        ).fetchone()
        assert row
        if row["pending"] >= limits.max_pending:
            raise DispatchError("The research queue is full. Retry the same request later.")
        conn.execute(
            "INSERT INTO run_jobs (command_id, state) VALUES (%s, 'queued') "
            "ON CONFLICT (command_id) DO UPDATE SET state = 'queued', owner_id = NULL, "
            "generation_attempts = 0, queued_at = clock_timestamp(), claimed_at = NULL, "
            "finished_at = NULL, last_error = NULL",
            (command["id"],),
        )

    def start(self, request: RunRequest) -> CommandReceipt:
        with self._admission() as conn:
            exists = conn.execute("SELECT 1 FROM runs WHERE id = %s", (request.id,)).fetchone()
            if not exists and not self._own_run(conn, request.id):
                raise DispatchError("This run is being admitted. Retry the same request.")
            command = self.runs.start_command(conn, request)
            if not exists:
                self._enqueue(conn, command)
            # An old interrupted command is never requeued by an HTTP retry.
            return receipt(command)

    def resume(self, run_id: UUID, request: ResumeRequest) -> CommandReceipt:
        with self._admission() as conn:
            exists = conn.execute(
                "SELECT 1 FROM run_commands WHERE run_id = %s AND interrupt_id = %s",
                (run_id, request.interrupt_id),
            ).fetchone()
            if not exists and not self._own_run(conn, run_id):
                raise ConflictError("This run is executing. Refresh before reviewing it.")
            command = self.runs.resume_command(conn, run_id, request)
            if not exists:
                self._enqueue(conn, command)
            return receipt(command)

    def recover(self, run_id: UUID) -> CommandReceipt:
        with self._admission() as conn:
            self.runs._manifest(conn, run_id)
            command = self.runs._unfinished(conn, run_id)
            if command is None:
                command = conn.execute(
                    "SELECT * FROM run_commands WHERE run_id = %s "
                    "ORDER BY created_at DESC, id DESC LIMIT 1",
                    (run_id,),
                ).fetchone()
                assert command
                return receipt(command)
            # Never wait for or disrupt a live worker.
            if not self._own_run(conn, run_id):
                return receipt(command)
            job = conn.execute(
                "SELECT state FROM run_jobs WHERE command_id = %s", (command["id"],)
            ).fetchone()
            if not job or job["state"] != "queued":
                self._enqueue(conn, command)
            return receipt(command)

    def configure(self, limits: QueueLimits) -> None:
        with self._admission() as conn:
            # Hold every possible worker slot until the new limits commit.
            for slot in range(8):
                row = conn.execute(
                    "SELECT pg_try_advisory_xact_lock(hashtextextended(%s, 0)) AS acquired",
                    (slot_key(self.database, slot),),
                ).fetchone()
                assert row
                if not row["acquired"]:
                    raise DispatchError("Stop active workers before changing queue limits.", 409)
            pending = conn.execute(
                "SELECT 1 FROM run_jobs WHERE state IN ('queued', 'running') LIMIT 1"
            ).fetchone()
            if pending:
                raise DispatchError(
                    "Drain or recover pending commands before changing limits.", 409
                )
            conn.execute(
                "UPDATE run_queue_limits SET max_parallel = %s, max_pending = %s",
                (limits.max_parallel, limits.max_pending),
            )
