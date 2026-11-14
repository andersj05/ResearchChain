"""Persisted execution budgets and cancellation independent of the run lock."""

from _thread import LockType
from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from researchchain.compiler import ExecutionStopped
from researchchain.graph import ExecutionBudgets


class ExecutionControl:
    def __init__(
        self, conn: Connection[DictRow], run_id: UUID, budgets: ExecutionBudgets, lock: LockType
    ) -> None:
        self.conn = conn
        self.run_id = run_id
        self.budgets = budgets
        # Guard queries must not enter/leave pipeline mode concurrently with
        # checkpoint writes on the same advisory-lock connection.
        self.lock = lock

    def begin(self) -> None:
        # An unclosed interval came from a killed process. Charge it conservatively,
        # including downtime, so restarting cannot reset an execution budget.
        self.conn.execute(
            "UPDATE run_controls SET active_seconds = active_seconds + "
            "COALESCE(EXTRACT(EPOCH FROM clock_timestamp() - active_started_at), 0), "
            "active_started_at = clock_timestamp() WHERE run_id = %s",
            (self.run_id,),
        )
        self.guard("", False)

    def end(self) -> None:
        self.conn.execute(
            "UPDATE run_controls SET active_seconds = active_seconds + "
            "COALESCE(EXTRACT(EPOCH FROM clock_timestamp() - active_started_at), 0), "
            "active_started_at = NULL WHERE run_id = %s",
            (self.run_id,),
        )

    def guard(self, path: str, count: bool) -> None:
        with self.lock:
            row = self.conn.execute(
                "SELECT terminal_status, reason, active_seconds + "
                "COALESCE(EXTRACT(EPOCH FROM clock_timestamp() - active_started_at), 0) "
                "AS elapsed, "
                "(SELECT count(*) FROM run_node_executions WHERE run_id = %s) AS executions, "
                "EXISTS(SELECT 1 FROM run_node_executions WHERE run_id = %s AND path = %s) "
                "AS already_counted FROM run_controls WHERE run_id = %s",
                (self.run_id, self.run_id, path, self.run_id),
            ).fetchone()
            assert row is not None
            if row["terminal_status"]:
                raise ExecutionStopped(
                    row["reason"] or "Run is already terminal.", row["terminal_status"]
                )
            if row["elapsed"] >= self.budgets.max_active_seconds:
                raise ExecutionStopped("Active execution time limit reached.")
            if count and not row["already_counted"]:
                if row["executions"] >= self.budgets.max_node_executions:
                    raise ExecutionStopped("Node execution limit reached.")
                self.conn.execute(
                    "INSERT INTO run_node_executions (run_id, path) VALUES (%s, %s) "
                    "ON CONFLICT DO NOTHING",
                    (self.run_id, path),
                )


def control_state(conn: Connection[DictRow], run_id: UUID) -> dict[str, Any]:
    row = conn.execute(
        "SELECT terminal_status, reason, active_seconds, "
        "(SELECT count(*) FROM run_node_executions WHERE run_id = %s) AS node_executions "
        "FROM run_controls WHERE run_id = %s",
        (run_id, run_id),
    ).fetchone()
    assert row is not None
    return row


def set_terminal(
    conn: Connection[DictRow], run_id: UUID, status: str, reason: str | None = None
) -> None:
    conn.execute(
        "UPDATE run_controls SET terminal_status = %s, reason = %s "
        "WHERE run_id = %s AND terminal_status IS NULL",
        (status, reason, run_id),
    )
