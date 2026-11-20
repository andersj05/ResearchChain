"""Append owner guidance and coordinate its cutoff with the editor's first reservation."""

from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from researchchain.database import Database
from researchchain.research_models import OwnerDirection, OwnerDirectionInput
from researchchain.research_sessions import SESSION_VERSION
from researchchain.revisions import ConflictError, NotFoundError

DIRECTIONS_VERSION = "owner-directions-1"
MAX_DIRECTIONS = 24


def pin_directions(conn: Connection[DictRow], run_id: UUID) -> list[OwnerDirection]:
    """The caller inserts the attempt before committing this same transaction."""
    conn.execute("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
    row = conn.execute(
        "SELECT owner_directions FROM run_controls WHERE run_id = %s FOR UPDATE", (run_id,)
    ).fetchone()
    assert row
    return [OwnerDirection.model_validate(item) for item in row["owner_directions"]]


def record_direction(
    database: Database, run_id: UUID, request: OwnerDirectionInput
) -> OwnerDirection:
    with database.connection() as conn, conn.transaction():
        conn.execute("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
        row = conn.execute(
            "SELECT c.terminal_status, c.owner_directions, "
            "m.manifest->'tool_config'->>'owner_directions_version' AS version "
            "FROM run_controls c JOIN run_research_manifests m ON m.run_id = c.run_id "
            "WHERE c.run_id = %s AND m.manifest->'tool_config'->>'session' = %s FOR UPDATE OF c",
            (run_id, SESSION_VERSION),
        ).fetchone()
        if not row:
            raise NotFoundError("Research session not found.")
        if row["version"] != DIRECTIONS_VERSION:
            raise ConflictError("This session version does not accept owner directions.")
        for item in row["owner_directions"]:
            if item["id"] == str(request.id):
                if item["text"] != request.text:
                    raise ConflictError("This direction ID already belongs to different text.")
                return OwnerDirection.model_validate(item)
        if row["terminal_status"]:
            raise ConflictError("This research session has ended.")
        if len(row["owner_directions"]) >= MAX_DIRECTIONS:
            raise ConflictError("The session has reached its limit of 24 owner directions.")
        # Under READ COMMITTED the separate statement observes an editor reservation
        # that committed while we were waiting for the controls row.
        if conn.execute(
            "SELECT 1 FROM research_attempts WHERE run_id = %s AND path = 'root/report'",
            (run_id,),
        ).fetchone():
            raise ConflictError("The report editor has already started writing.")
        saved = conn.execute(
            "UPDATE run_controls SET owner_directions = owner_directions || jsonb_build_array("
            "jsonb_build_object('id', %s::uuid, 'text', %s::text, "
            "'created_at', clock_timestamp())) "
            "WHERE run_id = %s RETURNING owner_directions -> -1 AS direction",
            (request.id, request.text, run_id),
        ).fetchone()
        assert saved
        return OwnerDirection.model_validate(saved["direction"])
