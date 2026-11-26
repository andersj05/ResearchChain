"""Admission checks for owner-requested replay from a stopped study."""

from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from researchchain.controls import ACTIVE_TIME_LIMIT_REASON
from researchchain.graph import ResearchLimits
from researchchain.providers.chatgpt_auth import (
    GENERIC_PROVIDER_ERROR,
    PROVIDER_OVERLOAD_CODES,
    TERMINAL_REFRESH_ERRORS,
)
from researchchain.research_models import ProviderFailure
from researchchain.research_perspectives import LEGACY_REPLAY_STOP_REASON
from researchchain.research_sessions import SESSION_VERSION

TRANSIENT_STREAM_CODES = {
    "internal_server_error",
    "rate_limit_exceeded",
    "server_error",
    "service_unavailable",
    "temporarily_unavailable",
} | PROVIDER_OVERLOAD_CODES

PEER_STOPPED_BEFORE_DISPATCH = "Another researcher failed before this request was sent."
MODEL_CALL_LIMIT_REASON = "Model-call budget reached."
TOOL_CALL_LIMIT_REASON = "Evidence-tool call budget reached."
CALL_LIMIT_REASONS = (MODEL_CALL_LIMIT_REASON, TOOL_CALL_LIMIT_REASON)


def _retryable(attempt: DictRow) -> bool:
    if (
        attempt["status"] != "failed"
        or attempt["response_id"] is not None
        or attempt["finished_at"] is None
    ):
        return False
    if attempt["reason"] == PEER_STOPPED_BEFORE_DISPATCH:
        return attempt["provider_failure"] is None
    if attempt["input_artifact_id"] is None:
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
    """Find a continuation for a retryable provider failure or a known legacy stop."""
    command = conn.execute(
        "SELECT c.id, c.checkpoint_id, c.interrupt_id, c.decision, c.feedback, "
        "c.response->>'status' AS command_status, controls.terminal_status, controls.reason, "
        "m.manifest->'settings'->'limits' AS limits "
        "FROM run_commands c JOIN run_controls controls ON controls.run_id = c.run_id "
        "JOIN run_research_manifests m ON m.run_id = c.run_id "
        "WHERE c.run_id = %s AND ("
        "(controls.terminal_status = 'failed' AND "
        "m.manifest->'tool_config'->>'swarm_version' IS NOT NULL) OR "
        "(controls.terminal_status = 'limited' AND controls.reason = ANY(%s))) "
        "AND m.manifest->'tool_config'->>'session' = %s "
        "AND NOT EXISTS (SELECT 1 FROM run_commands pending WHERE pending.run_id = c.run_id "
        "AND pending.response IS NULL) "
        "ORDER BY c.created_at DESC, c.id DESC LIMIT 1",
        (run_id, [ACTIVE_TIME_LIMIT_REASON, *CALL_LIMIT_REASONS], SESSION_VERSION),
    ).fetchone()
    if command is None or command["command_status"] != command["terminal_status"]:
        return None
    attempts = conn.execute(
        "SELECT a.status, a.input_artifact_id, a.response_id, a.finished_at, a.reason, "
        "a.provider_failure, d.admitted_at FROM research_attempts a "
        "LEFT JOIN model_request_admissions d ON d.id = a.id WHERE a.run_id = %s "
        "AND a.superseded_at IS NULL AND a.status <> 'completed'",
        (run_id,),
    ).fetchall()
    if command["terminal_status"] == "limited":
        # Clean stops occur between requests. An unfinished effect needs its own
        # recovery path even when there is now room under the study budget.
        if attempts:
            return None
        if command["reason"] in CALL_LIMIT_REASONS:
            limits = ResearchLimits.model_validate(command["limits"])
            count = conn.execute(
                "SELECT count(*) AS calls FROM research_attempts "
                "WHERE run_id = %s AND superseded_at IS NULL",
                (run_id,),
            ).fetchone()
            assert count is not None
            if count["calls"] >= min(limits.max_model_calls, limits.max_tool_calls):
                return None
        command["requires_confirmation"] = False
        return command
    if command["reason"] == LEGACY_REPLAY_STOP_REASON:
        if attempts or not (command["interrupt_id"] or "").startswith("perspective-"):
            return None
        # Recoveries copy the review. Require its original owner command and
        # completed receipts before allowing replay of a legacy duplicate answer.
        saved_review = conn.execute(
            "SELECT 1 FROM run_commands WHERE run_id = %s AND kind = 'resume' "
            "AND checkpoint_id = %s AND interrupt_id = %s AND decision = 'approve' "
            "AND feedback = %s",
            (run_id, command["checkpoint_id"], command["interrupt_id"], command["feedback"]),
        ).fetchone()
        if saved_review is None or command["decision"] != "approve":
            return None
        command["requires_confirmation"] = False
        return command
    if all(_retryable(attempt) for attempt in attempts) and any(
        attempt["reason"] == command["reason"] for attempt in attempts
    ):
        # Older parallel stops copied the provider's generic message to admitted
        # peers, even when the peer's own outcome was never recorded.
        command["requires_confirmation"] = any(
            a["provider_failure"] is not None for a in attempts
        ) and any(
            a["provider_failure"] is None
            and a["reason"] == GENERIC_PROVIDER_ERROR
            and a["admitted_at"] is not None
            for a in attempts
        )
        return command
    return None
