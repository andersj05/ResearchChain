"""Reject delayed requests before provider selection or any graph work."""

from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from researchchain.retention_models import RetentionError


def require_retained_run(conn: Connection[DictRow], run_id: UUID) -> None:
    if conn.execute(
        "SELECT 1 FROM retention_run_tombstones WHERE run_id = %s", (run_id,)
    ).fetchone():
        raise RetentionError("This run was deleted. Start new work with a new run ID.", 410)
