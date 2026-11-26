"""Journal owner steering at the same boundary that admits model requests."""

from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from researchchain.database import Database
from researchchain.research_models import (
    OwnerDirection,
    OwnerDirectionInput,
    OwnerReportRequest,
    OwnerReportRequestInput,
)
from researchchain.research_sessions import SESSION_VERSION
from researchchain.revisions import ConflictError, NotFoundError

DIRECTIONS_VERSION = "owner-directions-1"
MAX_DIRECTIONS = 24


class ReportHandoffRequested(Exception):
    """End swarm scheduling at a reservation boundary without stopping the run."""


def pin_directions(conn: Connection[DictRow], run_id: UUID, path: str) -> list[OwnerDirection]:
    """The caller inserts the attempt before committing this same transaction."""
    conn.execute("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
    row = conn.execute(
        "SELECT owner_directions, owner_report_request FROM run_controls "
        "WHERE run_id = %s FOR UPDATE",
        (run_id,),
    ).fetchone()
    assert row
    if row["owner_report_request"] is not None and path.startswith("root/team/"):
        raise ReportHandoffRequested()
    notes = map(OwnerDirection.model_validate, row["owner_directions"])
    return [
        note
        for note in notes
        if note.target_path is None
        or path == note.target_path
        or path.startswith(note.target_path + "/")
    ]


def lock_guided_session(conn: Connection[DictRow], run_id: UUID) -> DictRow:
    row = conn.execute(
        "SELECT c.terminal_status, c.owner_directions, c.owner_report_request, "
        "m.manifest->'tool_config'->>'owner_directions_version' AS version, "
        "m.manifest->'tool_config' ? 'swarm_version' AS swarm "
        "FROM run_controls c JOIN run_research_manifests m ON m.run_id = c.run_id "
        "WHERE c.run_id = %s AND m.manifest->'tool_config'->>'session' = %s FOR UPDATE OF c",
        (run_id, SESSION_VERSION),
    ).fetchone()
    if not row:
        raise NotFoundError("Research session not found.")
    if row["version"] != DIRECTIONS_VERSION:
        raise ConflictError("This session version does not accept owner directions.")
    return row


def editor_started(conn: Connection[DictRow], run_id: UUID) -> bool:
    # With the controls row locked, a fresh READ COMMITTED statement also observes
    # an editor reservation that committed while the caller was waiting for that row.
    return (
        conn.execute(
            "SELECT 1 FROM research_attempts WHERE run_id = %s AND path = 'root/report'",
            (run_id,),
        ).fetchone()
        is not None
    )


def _validate_target(conn: Connection[DictRow], run_id: UUID, path: str) -> None:
    lead_path, _, worker_number = path.partition("/agent-")
    lead = int(lead_path.rsplit("-", 1)[1])
    roster = conn.execute(
        "SELECT jsonb_array_length(result->'swarm_plan'->'leads') AS leads "
        "FROM research_attempts WHERE run_id = %s AND path = 'root/team/plan' "
        "AND status = 'completed'",
        (run_id,),
    ).fetchone()
    if not roster or not roster["leads"] or lead > roster["leads"]:
        raise ConflictError("This lead has no confirmed assignment in the study.")
    turns = conn.execute(
        "SELECT coalesce(sum(jsonb_array_length(result->'swarm_action'->'assignments')) "
        "FILTER (WHERE result->'swarm_action'->>'action' = 'delegate'), 0) AS assignments, "
        "bool_or(result->'swarm_action'->>'action' = 'finish') AS finished "
        "FROM research_attempts WHERE run_id = %s AND starts_with(path, %s) "
        "AND status = 'completed'",
        (run_id, lead_path + "/turn-"),
    ).fetchone()
    assert turns
    if turns["finished"]:
        raise ConflictError("This lead has completed its mandate. Send a direction to the team.")
    if worker_number:
        if int(worker_number) > turns["assignments"]:
            raise ConflictError("This researcher has no confirmed assignment in the study.")
        if conn.execute(
            "SELECT 1 FROM research_attempts WHERE run_id = %s AND "
            "(path = %s OR starts_with(path, %s)) AND status = 'completed' "
            "AND result->>'next_lead' IS NULL AND result->>'workspace_activity' IS NULL",
            (run_id, path, path + "/analyst-pass-"),
        ).fetchone():
            raise ConflictError("This researcher has finished. Send a direction to their lead.")


def record_direction(
    database: Database, run_id: UUID, request: OwnerDirectionInput
) -> OwnerDirection:
    with database.connection() as conn, conn.transaction():
        conn.execute("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
        row = lock_guided_session(conn, run_id)
        for item in row["owner_directions"]:
            if item["id"] == str(request.id):
                if item["text"] != request.text or item.get("target_path") != request.target_path:
                    raise ConflictError("This direction ID already belongs to another direction.")
                return OwnerDirection.model_validate(item)
        if row["terminal_status"]:
            raise ConflictError("This research session has ended.")
        if len(row["owner_directions"]) >= MAX_DIRECTIONS:
            raise ConflictError("The session has reached its limit of 24 owner directions.")
        if editor_started(conn, run_id):
            raise ConflictError("The report editor has already started writing.")
        if request.target_path:
            if row["owner_report_request"] is not None:
                raise ConflictError("Research has been sent to the report editor.")
            _validate_target(conn, run_id, request.target_path)
        saved = conn.execute(
            "UPDATE run_controls SET owner_directions = owner_directions || jsonb_build_array("
            "jsonb_strip_nulls(jsonb_build_object('id', %s::uuid, 'text', %s::text, "
            "'target_path', %s::text, 'created_at', clock_timestamp()))) "
            "WHERE run_id = %s RETURNING owner_directions -> -1 AS direction",
            (request.id, request.text, request.target_path, run_id),
        ).fetchone()
        assert saved
        return OwnerDirection.model_validate(saved["direction"])


def has_confirmed_swarm_findings(conn: Connection[DictRow], run_id: UUID) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM research_attempts WHERE run_id = %s AND status = 'completed' "
            "AND result IS NOT NULL AND starts_with(path, 'root/team/lead-') "
            "AND (result->'swarm_action'->>'action' = 'finish' OR "
            "(path ~ '^root/team/lead-[1-4]/agent-[0-9]+(/analyst-pass-[0-9]+)?$' "
            "AND result->>'workspace_activity' IS NULL AND result->>'next_lead' IS NULL)) LIMIT 1",
            (run_id,),
        ).fetchone()
        is not None
    )


def read_report_request(
    conn: Connection[DictRow], run_id: UUID, *, lock: bool = False
) -> OwnerReportRequest | None:
    query = "SELECT owner_report_request FROM run_controls WHERE run_id = %s"
    row = conn.execute(query + " FOR UPDATE" if lock else query, (run_id,)).fetchone()
    assert row
    request = row["owner_report_request"]
    return OwnerReportRequest.model_validate(request) if request is not None else None


def save_report_request(
    conn: Connection[DictRow], run_id: UUID, request: OwnerReportRequestInput
) -> OwnerReportRequest:
    row = conn.execute(
        "UPDATE run_controls SET owner_report_request = "
        "jsonb_build_object('id', %s::uuid, 'text', %s::text, 'created_at', clock_timestamp()) "
        "WHERE run_id = %s RETURNING owner_report_request",
        (request.id, request.text, run_id),
    ).fetchone()
    assert row
    return OwnerReportRequest.model_validate(row["owner_report_request"])
