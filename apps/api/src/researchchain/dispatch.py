"""Atomic command admission; no graph execution in HTTP requests."""

from collections.abc import Iterator
from contextlib import contextmanager
from uuid import UUID, uuid4

from psycopg import Connection
from psycopg.errors import LockNotAvailable
from psycopg.rows import DictRow

from researchchain.database import Database
from researchchain.dispatch_models import CommandReceipt, DispatchError, QueueLimits
from researchchain.models import ResumeRequest, RunRequest
from researchchain.research_directions import (
    editor_started,
    has_confirmed_swarm_findings,
    lock_guided_session,
    save_report_request,
)
from researchchain.research_models import OwnerReportRequest, OwnerReportRequestInput
from researchchain.research_recovery import recovery_candidate
from researchchain.research_sessions import ResearchSessionStart, session_workflow
from researchchain.revisions import ConflictError, save_revision
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


def presence_key(database: Database) -> str:
    return f"worker-presence:{database.schema}"


class RunQueue:
    def __init__(self, runs: RunStore) -> None:
        self.runs = runs
        self.database = runs.database

    @contextmanager
    def _admission(self) -> Iterator[Connection[DictRow]]:
        with self.database.connection() as conn, conn.transaction():
            conn.execute("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
            conn.execute("SET LOCAL lock_timeout = '1000ms'")
            try:
                conn.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                    (f"admission:{self.database.schema}",),
                )
            except LockNotAvailable:
                raise DispatchError("Command admission is busy. Retry the same request.") from None
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
            return self._start(conn, request)

    def start_session(self, request: ResearchSessionStart) -> CommandReceipt:
        workflow = session_workflow(request)
        with self._admission() as conn:
            revision = save_revision(conn, workflow)
            return self._start(
                conn,
                RunRequest(
                    id=request.id,
                    revision_id=revision.id,
                    baseline_run_id=request.baseline_run_id,
                    brief=request.brief,
                    evidence_ids=request.evidence_ids,
                    provider_account_id=request.provider_account_id,
                ),
                research_session=True,
                study_title=request.title,
            )

    def _start(
        self,
        conn: Connection[DictRow],
        request: RunRequest,
        *,
        research_session: bool = False,
        study_title: str | None = None,
    ) -> CommandReceipt:
        exists = conn.execute("SELECT 1 FROM runs WHERE id = %s", (request.id,)).fetchone()
        if not exists and not self._own_run(conn, request.id):
            raise DispatchError("This run is being admitted. Retry the same request.")
        command = self.runs.start_command(
            conn, request, research_session=research_session, study_title=study_title
        )
        if not exists:
            self._enqueue(conn, command)
        # An old interrupted command is never requeued by an HTTP retry.
        return receipt(command)

    def resume(self, run_id: UUID, request: ResumeRequest) -> CommandReceipt:
        with self._admission() as conn:
            exists = conn.execute(
                "SELECT 1 FROM run_commands WHERE run_id = %s AND interrupt_id = %s "
                "AND kind = 'resume'",
                (run_id, request.interrupt_id),
            ).fetchone()
            if not exists and not self._own_run(conn, run_id):
                if self.runs._unfinished(conn, run_id) is not None:
                    raise ConflictError("This run is executing. Refresh before reviewing it.")
                # An idle snapshot reader (or a worker saving its final receipt)
                # can briefly retain the lock after the command is complete.
                # Wait only for idle ownership, under the admission's 1s limit.
                try:
                    with conn.transaction():
                        conn.execute(
                            "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                            (f"run:{run_id}",),
                        )
                except LockNotAvailable:
                    raise DispatchError("This run is busy. Retry the same review.") from None
            command = self.runs.resume_command(conn, run_id, request)
            if not exists:
                self._enqueue(conn, command)
            return receipt(command)

    def recover(
        self,
        run_id: UUID,
        failed_command_id: UUID | None = None,
        *,
        confirm_unrecorded: bool = False,
    ) -> CommandReceipt:
        with self._admission() as conn:
            self.runs._manifest(conn, run_id)
            if failed_command_id is not None:
                return self._recover_failed(conn, run_id, failed_command_id, confirm_unrecorded)
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

    def request_report(self, run_id: UUID, request: OwnerReportRequestInput) -> OwnerReportRequest:
        with self._admission() as conn:
            controls = lock_guided_session(conn, run_id)
            if controls["owner_report_request"] is not None:
                saved = OwnerReportRequest.model_validate(controls["owner_report_request"])
                if saved.id != request.id or saved.text != request.text:
                    raise ConflictError("This study has already been sent to the report editor.")
                return saved
            if not controls["swarm"] or controls["terminal_status"] or editor_started(conn, run_id):
                raise ConflictError("This study is no longer accepting a report handoff.")
            if not has_confirmed_swarm_findings(conn, run_id):
                raise ConflictError("Wait until the team saves a confirmed finding.")
            manifest = self.runs._manifest(conn, run_id)
            active = self.runs._unfinished(conn, run_id)
            if active is None:
                if not self._own_run(conn, run_id):
                    raise DispatchError("The study is finishing its current action. Try again.")
                snapshot = self.runs._snapshot(conn, manifest)
                if not snapshot.can_request_report:
                    raise ConflictError("This study has no current handoff to the editor.")
                # A handoff is a continuation, but its ID must never be interpreted
                # as the owner answering an outstanding expert question.
                command = conn.execute(
                    "INSERT INTO run_commands (id, run_id, kind, checkpoint_id, interrupt_id, "
                    "decision) VALUES (%s, %s, 'resume', %s, %s, 'approve') RETURNING *",
                    (uuid4(), run_id, snapshot.checkpoint_id, f"owner-report-{request.id}"),
                ).fetchone()
                assert command
                self._enqueue(conn, command)
            elif conn.execute(
                "SELECT 1 FROM run_jobs WHERE command_id = %s AND state = 'interrupted'",
                (active["id"],),
            ).fetchone():
                raise ConflictError("Resume the interrupted study before requesting a report.")
            return save_report_request(conn, run_id, request)

    def _recover_failed(
        self,
        conn: Connection[DictRow],
        run_id: UUID,
        failed_command_id: UUID,
        confirm_unrecorded: bool,
    ) -> CommandReceipt:
        previous = conn.execute(
            "SELECT * FROM run_commands WHERE run_id = %s AND recovery_of = %s",
            (run_id, failed_command_id),
        ).fetchone()
        if previous is not None:
            return receipt(previous)
        if not self._own_run(conn, run_id):
            raise DispatchError("This study is busy. Try resuming again.", 409)
        failed = recovery_candidate(conn, run_id)
        if failed is None or failed["id"] != failed_command_id:
            raise ConflictError("This study failure cannot be resumed. Refresh the study.")
        if failed["requires_confirmation"] and not confirm_unrecorded:
            raise ConflictError(
                "Confirm that a request with no recorded outcome may be sent again."
            )
        command = conn.execute(
            "INSERT INTO run_commands "
            "(id, run_id, kind, recovery_of, checkpoint_id, interrupt_id, decision, feedback) "
            "VALUES (%s, %s, 'recover', %s, %s, %s, %s, %s) RETURNING *",
            (
                uuid4(),
                run_id,
                failed_command_id,
                failed["checkpoint_id"],
                failed["interrupt_id"],
                failed["decision"],
                failed["feedback"],
            ),
        ).fetchone()
        assert command
        conn.execute(
            "UPDATE research_attempts SET superseded_at = clock_timestamp() "
            "WHERE run_id = %s AND status = 'failed' AND superseded_at IS NULL",
            (run_id,),
        )
        conn.execute(
            "UPDATE run_controls SET terminal_status = NULL, reason = NULL WHERE run_id = %s",
            (run_id,),
        )
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
