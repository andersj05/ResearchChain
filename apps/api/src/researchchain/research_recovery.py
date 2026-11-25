"""Admission checks for owner-requested replay after confirmed provider failures."""

from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from researchchain.providers.chatgpt_auth import GENERIC_PROVIDER_ERROR, TERMINAL_REFRESH_ERRORS
from researchchain.research_models import ProviderFailure
from researchchain.research_sessions import SESSION_VERSION

TRANSIENT_STREAM_CODES = {
    "engine_overloaded",
    "internal_server_error",
    "overloaded",
    "rate_limit_exceeded",
    "server_error",
    "service_unavailable",
    "temporarily_unavailable",
}


def _retryable(attempt: DictRow) -> bool:
    if (
        attempt["status"] != "failed"
        or attempt["input_artifact_id"] is None
        or attempt["response_id"] is not None
        or attempt["finished_at"] is None
    ):
        return False
    if attempt["provider_failure"] is None:
        # Earlier builds journaled only this exact provider-reported failure.
        reason = attempt["reason"]
        return isinstance(reason, str) and reason == GENERIC_PROVIDER_ERROR
    failure = ProviderFailure.model_validate(attempt["provider_failure"])
    if failure.code and (
        failure.code in TERMINAL_REFRESH_ERRORS or failure.code.startswith("subscription_sharing_")
    ):
        return False
    status = failure.http_status
    return (
        status == 429
        or (status is not None and 500 <= status <= 599)
        or (
            failure.source == "stream"
            and (failure.code is None or failure.code in TRANSIENT_STREAM_CODES)
        )
    )


def recovery_candidate(conn: Connection[DictRow], run_id: UUID) -> DictRow | None:
    """A completed failed command can be replaced only when every effect is known."""
    command = conn.execute(
        "SELECT c.id, c.checkpoint_id, c.interrupt_id, c.decision, c.feedback, "
        "c.response->>'status' AS command_status, controls.reason "
        "FROM run_commands c JOIN run_controls controls ON controls.run_id = c.run_id "
        "JOIN run_research_manifests m ON m.run_id = c.run_id "
        "WHERE c.run_id = %s AND controls.terminal_status = 'failed' "
        "AND m.manifest->'tool_config'->>'session' = %s "
        "AND m.manifest->'tool_config'->>'swarm_version' IS NOT NULL "
        "AND NOT EXISTS (SELECT 1 FROM run_commands pending WHERE pending.run_id = c.run_id "
        "AND pending.response IS NULL) "
        "ORDER BY c.created_at DESC, c.id DESC LIMIT 1",
        (run_id, SESSION_VERSION),
    ).fetchone()
    if command is None or command["command_status"] != "failed":
        return None
    attempts = conn.execute(
        "SELECT status, input_artifact_id, response_id, finished_at, reason, provider_failure "
        "FROM research_attempts WHERE run_id = %s "
        "AND superseded_at IS NULL AND status <> 'completed'",
        (run_id,),
    ).fetchall()
    if all(_retryable(attempt) for attempt in attempts) and any(
        attempt["reason"] == command["reason"] for attempt in attempts
    ):
        return command
    return None
