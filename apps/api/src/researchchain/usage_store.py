"""Atomic, committed request admissions shared by all workspace processes."""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import timedelta
from uuid import UUID

import psycopg
from psycopg import Connection
from psycopg.pq import TransactionStatus
from psycopg.rows import DictRow

from researchchain.database import Database
from researchchain.usage_models import (
    PolicyActor,
    RequestAdmission,
    RequestSource,
    UsageError,
    UsagePolicy,
    UsagePolicyUpdate,
    UsageSnapshot,
)


@contextmanager
def _locked(conn: Connection[DictRow]) -> Iterator[None]:
    # A nested transaction could roll back after a provider request was sent.
    # Retain the caller's physical execution connection and its session locks.
    if not conn.autocommit or conn.info.transaction_status != TransactionStatus.IDLE:
        raise UsageError("Request admission requires its own committed transaction.", 503)
    try:
        with conn.transaction():
            isolation = conn.execute("SHOW transaction_isolation").fetchone()
            if isolation is None or isolation["transaction_isolation"] != "read committed":
                raise UsageError("Request admission requires READ COMMITTED isolation.", 503)
            conn.execute("SET LOCAL lock_timeout = '3000ms'")
            conn.execute(
                "SELECT pg_advisory_xact_lock("
                "hashtextextended('model-admission:' || current_schema(), 0))"
            )
            yield
    except psycopg.Error:
        raise UsageError(
            "Request allowance could not be verified. No model request was sent.", 503
        ) from None


def _policy(conn: Connection[DictRow]) -> UsagePolicy:
    row = conn.execute(
        "SELECT * FROM request_allowance_policies ORDER BY revision DESC LIMIT 1"
    ).fetchone()
    if row is None:
        raise UsageError("Request allowance is not configured. Check database migrations.", 503)
    return UsagePolicy.model_validate(row)


def _snapshot(conn: Connection[DictRow]) -> UsageSnapshot:
    policy = _policy(conn)
    clock = conn.execute("SELECT clock_timestamp() AS observed_at").fetchone()
    assert clock is not None
    observed_at = clock["observed_at"]
    cutoff = observed_at - timedelta(hours=24)
    count = conn.execute(
        "SELECT count(*) AS used FROM model_request_admissions WHERE admitted_at > %s", (cutoff,)
    ).fetchone()
    assert count is not None
    used = count["used"]
    next_slot_at = None
    if used >= policy.max_requests_24h:
        # When a limit is lowered below current usage, several older admissions
        # may have to expire. Future timestamps remain counted after clock rollback.
        expiry = conn.execute(
            "SELECT admitted_at + interval '24 hours' AS expires_at "
            "FROM model_request_admissions WHERE admitted_at > %s "
            "ORDER BY admitted_at, id OFFSET %s LIMIT 1",
            (cutoff, used - policy.max_requests_24h),
        ).fetchone()
        assert expiry is not None
        next_slot_at = expiry["expires_at"]
    return UsageSnapshot(
        observed_at=observed_at,
        window_started_at=cutoff,
        policy=policy,
        admitted_requests_24h=used,
        remaining_requests=max(0, policy.max_requests_24h - used),
        next_slot_at=next_slot_at,
    )


def admit_request(
    conn: Connection[DictRow], request_id: UUID, source: RequestSource
) -> RequestAdmission:
    if source not in {"research", "connection_test"}:
        raise ValueError("Unknown model request source.")
    with _locked(conn):
        if conn.execute(
            "SELECT 1 FROM model_request_admissions WHERE id = %s", (request_id,)
        ).fetchone():
            raise UsageError("This model request was already admitted; it cannot be resent.", 409)
        snapshot = _snapshot(conn)
        if snapshot.policy.paused:
            raise UsageError("New model requests are paused for this workspace.")
        if snapshot.remaining_requests == 0:
            raise UsageError(
                "Workspace request allowance reached. "
                "Check Operations before starting more research."
            )
        admission = RequestAdmission(
            id=request_id,
            admitted_at=snapshot.observed_at,
            source=source,
            policy_revision=snapshot.policy.revision,
        )
        conn.execute(
            "INSERT INTO model_request_admissions (id, admitted_at, source, policy_revision) "
            "VALUES (%s, %s, %s, %s)",
            (admission.id, admission.admitted_at, source, admission.policy_revision),
        )
    # Leaving _locked commits before the caller can contact a model.
    return admission


class UsageStore:
    def __init__(self, database: Database):
        self.database = database

    def admit(self, request_id: UUID, source: RequestSource) -> RequestAdmission:
        try:
            with self.database.connection() as conn:
                return admit_request(conn, request_id, source)
        except psycopg.Error:
            raise UsageError(
                "Request allowance could not be verified. No model request was sent.", 503
            ) from None

    def snapshot(self) -> UsageSnapshot:
        try:
            with self.database.connection() as conn, conn.transaction():
                conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
                return _snapshot(conn)
        except psycopg.Error:
            raise UsageError("Request allowance is unavailable. Check the database.", 503) from None

    def configure(self, update: UsagePolicyUpdate, actor: PolicyActor) -> UsageSnapshot:
        if actor not in {"owner", "operator"}:
            raise ValueError("Unknown policy actor.")
        try:
            with self.database.connection() as conn, _locked(conn):
                current = _policy(conn)
                if update.expected_revision != current.revision:
                    raise UsageError(
                        "Request limits changed. Refresh and review the current settings.", 409
                    )
                if (update.max_requests_24h, update.paused) != (
                    current.max_requests_24h,
                    current.paused,
                ):
                    conn.execute(
                        "INSERT INTO request_allowance_policies "
                        "(revision, max_requests_24h, paused, changed_by) VALUES (%s, %s, %s, %s)",
                        (current.revision + 1, update.max_requests_24h, update.paused, actor),
                    )
                return _snapshot(conn)
        except psycopg.Error:
            raise UsageError(
                "Request limits could not be saved. Refresh before trying again.", 503
            ) from None
