from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import uuid4

import psycopg
import pytest

from researchchain.database import Database
from researchchain.usage_models import UsageError, UsagePolicyUpdate
from researchchain.usage_store import UsageStore, admit_request


def configure(database: Database, maximum: int, *, paused: bool = False):
    store = UsageStore(database)
    return store.configure(
        UsagePolicyUpdate(
            expected_revision=store.snapshot().policy.revision,
            max_requests_24h=maximum,
            paused=paused,
        ),
        "operator",
    )


def grant(database: Database, request_id=None, source="research"):
    with database.connection() as conn:
        return admit_request(conn, request_id or uuid4(), source)


def historical(database: Database, times: list[datetime]) -> None:
    with database.connection() as conn:
        for timestamp in times:
            conn.execute(
                "INSERT INTO model_request_admissions VALUES (%s,%s,'imported_research',NULL)",
                (uuid4(), timestamp),
            )


def test_committed_admission_survives_reopening_and_duplicate_is_not_reusable(database):
    configure(database, 1)
    request_id = uuid4()
    admission = grant(database, request_id)
    assert admission.policy_revision == 2
    reopened = UsageStore(database).snapshot()
    assert reopened.admitted_requests_24h == 1 and reopened.remaining_requests == 0
    with pytest.raises(UsageError, match="cannot be resent") as failure:
        grant(database, request_id)
    assert failure.value.status == 409
    with pytest.raises(UsageError, match="allowance reached"):
        grant(database, source="connection_test")
    assert UsageStore(database).snapshot().admitted_requests_24h == 1


def test_parallel_connections_cannot_take_the_last_slot_twice(database):
    configure(database, 1)
    barrier = Barrier(6)

    def enter(_):
        with database.connection() as conn:
            barrier.wait(timeout=10)
            try:
                admit_request(conn, uuid4(), "research")
                return "admitted"
            except UsageError as error:
                return error.status

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(enter, range(6)))
    assert results.count("admitted") == 1
    assert results.count(429) == 5
    assert UsageStore(database).snapshot().admitted_requests_24h == 1


def test_pause_and_resume_keep_all_previous_admissions(database):
    configure(database, 3)
    grant(database)
    paused = configure(database, 3, paused=True)
    assert paused.policy.paused and paused.remaining_requests == 2
    with pytest.raises(UsageError, match="paused"):
        grant(database)
    resumed = configure(database, 3)
    assert resumed.policy.revision == 4 and resumed.admitted_requests_24h == 1
    grant(database, source="connection_test")
    assert UsageStore(database).snapshot().remaining_requests == 1


def test_lower_limit_waits_for_enough_expirations_and_counts_future_times(database):
    now = datetime.now(UTC)
    times = [now - timedelta(hours=23), now - timedelta(hours=22), now + timedelta(hours=1)]
    historical(database, times + [now - timedelta(hours=25)])
    snapshot = configure(database, 1)
    assert snapshot.admitted_requests_24h == 3 and snapshot.remaining_requests == 0
    assert snapshot.next_slot_at == times[-1] + timedelta(hours=24)
    with pytest.raises(UsageError, match="allowance reached"):
        grant(database)
    raised = configure(database, 4)
    assert raised.remaining_requests == 1 and raised.next_slot_at is None


def test_expired_admissions_do_not_consume_the_rolling_window(database):
    historical(database, [datetime.now(UTC) - timedelta(hours=24, seconds=1)])
    configure(database, 1)
    grant(database)
    assert UsageStore(database).snapshot().admitted_requests_24h == 1


def test_concurrent_policy_edits_have_one_winner_and_preserve_history(database):
    barrier = Barrier(2)

    def edit(maximum):
        barrier.wait(timeout=10)
        try:
            return (
                UsageStore(database)
                .configure(
                    UsagePolicyUpdate(expected_revision=1, max_requests_24h=maximum, paused=True),
                    "owner",
                )
                .policy.revision
            )
        except UsageError as error:
            return error.status

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(edit, [7, 8]))
    assert sorted(results) == [2, 409]
    with database.connection() as conn:
        rows = conn.execute("SELECT * FROM request_allowance_policies ORDER BY revision").fetchall()
    assert len(rows) == 2 and rows[0]["max_requests_24h"] == 100
    assert rows[1]["changed_by"] == "owner"


def test_unchanged_policy_does_not_create_another_revision(database):
    snapshot = configure(database, 100)
    assert snapshot.policy.revision == 1


def test_caller_transaction_cannot_roll_back_an_already_sent_admission(database):
    with database.connection() as conn, conn.transaction():
        with pytest.raises(UsageError, match="own committed transaction"):
            admit_request(conn, uuid4(), "research")
    assert UsageStore(database).snapshot().admitted_requests_24h == 0


def test_repeatable_read_cannot_use_a_snapshot_before_the_admission_lock(database):
    with database.connection() as conn:
        conn.execute("SET default_transaction_isolation = 'repeatable read'")
        with pytest.raises(UsageError, match="READ COMMITTED"):
            admit_request(conn, uuid4(), "research")
    assert UsageStore(database).snapshot().admitted_requests_24h == 0


def test_admission_keeps_the_callers_physical_execution_lock(database):
    key = f"usage-execution-test:{uuid4()}"
    with database.connection() as conn, database.connection() as rival:
        conn.execute("SELECT pg_advisory_lock(hashtextextended(%s,0))", (key,))
        backend = conn.info.backend_pid
        admit_request(conn, uuid4(), "research")
        assert conn.info.backend_pid == backend
        locked = rival.execute(
            "SELECT pg_try_advisory_lock(hashtextextended(%s,0)) AS acquired", (key,)
        ).fetchone()
        assert locked and locked["acquired"] is False


def test_admissions_and_policy_history_are_append_only(database):
    grant(database)
    with database.connection() as conn:
        for statement in [
            "DELETE FROM model_request_admissions",
            "UPDATE model_request_admissions SET admitted_at = now() - interval '2 days'",
            "DELETE FROM request_allowance_policies",
            "UPDATE request_allowance_policies SET paused = true",
        ]:
            with pytest.raises(psycopg.errors.CheckViolation, match="append-only"):
                conn.execute(statement)
    assert UsageStore(database).snapshot().admitted_requests_24h == 1


def test_storage_failure_is_redacted_and_never_grants_admission(database, monkeypatch):
    with database.connection() as conn:
        original = conn.execute

        def fail(statement, *args, **kwargs):
            if "model_request_admissions" in statement:
                raise psycopg.OperationalError("secret-database-canary")
            return original(statement, *args, **kwargs)

        monkeypatch.setattr(conn, "execute", fail)
        with pytest.raises(UsageError) as failure:
            admit_request(conn, uuid4(), "research")
        assert failure.value.status == 503 and "canary" not in str(failure.value)
    assert UsageStore(database).snapshot().admitted_requests_24h == 0
