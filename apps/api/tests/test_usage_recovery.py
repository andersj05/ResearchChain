"""Usage recovery tests create only disposable synthetic schemas/databases."""

import multiprocessing
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo
from test_usage_store import configure

from researchchain import database as database_module
from researchchain.backup import create_backup
from researchchain.backup_inventory import inventory
from researchchain.backup_restore import restore_backup
from researchchain.database import Database
from researchchain.graph import Workflow
from researchchain.revisions import RevisionStore
from researchchain.usage_models import UsageError
from researchchain.usage_store import UsageStore


def compete(url, schema, start, results):
    assert start.wait(15)
    try:
        UsageStore(Database(url, schema)).admit(uuid4(), "connection_test")
        results.put("admitted")
    except UsageError as error:
        results.put(error.status)


def test_separate_processes_share_the_last_request_slot(database):
    configure(database, 1)
    context = multiprocessing.get_context("spawn")
    start, results = context.Event(), context.Queue()
    processes = [
        context.Process(target=compete, args=(database.url, database.schema, start, results))
        for _ in range(3)
    ]
    for process in processes:
        process.start()
    try:
        start.set()
        outcomes = [results.get(timeout=20) for _ in processes]
        assert outcomes.count("admitted") == 1 and outcomes.count(429) == 2
    finally:
        for process in processes:
            process.join(timeout=10)
            if process.is_alive():
                process.terminate()
                process.join(timeout=5)
            assert process.exitcode == 0
        results.close()
        results.join_thread()


@pytest.mark.parametrize("rollback", [False, True])
def test_schema_9_upgrade_preserves_research_and_imports_old_attempts(
    database, workflow, monkeypatch, rollback
):
    legacy = Database(database.url, "test_" + uuid4().hex)
    migrations = database_module.migrations()
    assert migrations[-1][0] == "0010_request_allowance.sql"
    try:
        with monkeypatch.context() as patch:
            patch.setattr(database_module, "migrations", lambda: migrations[:-1])
            legacy.migrate()
            revision = RevisionStore(legacy).save(Workflow.model_validate(workflow))
            run_id = uuid4()
            with legacy.connection() as conn:
                conn.execute(
                    "INSERT INTO runs (id,revision_id,compiler_version,brief) VALUES (%s,%s,%s,%s)",
                    (run_id, revision.id, "synthetic", "synthetic migration canary"),
                )
                for hours in [1, 25]:
                    conn.execute(
                        "INSERT INTO research_attempts "
                        "(id,run_id,path,stage,model,status,created_at) "
                        "VALUES (%s,%s,%s,'hypothesize','synthetic','requesting',%s)",
                        (uuid4(), run_id, str(hours), datetime.now(UTC) - timedelta(hours=hours)),
                    )
        with legacy.connection() as conn, conn.transaction():
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            before = inventory(conn, legacy.schema)
        if rollback:
            name, checksum, statement = migrations[-1]
            broken = [*migrations[:-1], (name, checksum, statement + "\nSELECT 1 / 0;")]
            with monkeypatch.context() as patch:
                patch.setattr(database_module, "migrations", lambda: broken)
                with pytest.raises(psycopg.errors.DivisionByZero):
                    legacy.migrate()
            with legacy.connection() as conn, conn.transaction():
                failed = inventory(conn, legacy.schema)
            assert failed.tables == before.tables
        legacy.migrate()
        legacy.migrate()
        with legacy.connection() as conn, conn.transaction():
            after = inventory(conn, legacy.schema)
            imported = conn.execute(
                "SELECT source,policy_revision FROM model_request_admissions"
            ).fetchall()
        for name, fingerprint in before.tables.items():
            if name != "schema_migrations":
                assert after.tables[name] == fingerprint
        assert after.tables["schema_migrations"].rows == 10
        assert len(imported) == 2
        assert all(
            row == {"source": "imported_research", "policy_revision": None} for row in imported
        )
        snapshot = UsageStore(legacy).snapshot()
        assert snapshot.admitted_requests_24h == 1 and snapshot.remaining_requests == 99
    finally:
        assert legacy.schema.startswith("test_") and len(legacy.schema) == 37
        with database.connection() as conn:
            conn.execute(
                sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(legacy.schema))
            )


def test_verified_backup_restore_preserves_policy_history_and_consumed_slots(
    database, tmp_path, restore_target
):
    configure(database, 2)
    UsageStore(database).admit(uuid4(), "research")
    configure(database, 2, paused=True)
    directory = tmp_path / "usage-backup"
    create_backup(database, directory)
    restore_backup(database, directory, restore_target, trusted=True)
    restored = Database(make_conninfo(database.url, dbname=restore_target), database.schema)
    snapshot = UsageStore(restored).snapshot()
    assert snapshot.policy.paused and snapshot.policy.revision == 3
    assert snapshot.admitted_requests_24h == 1 and snapshot.remaining_requests == 1
    with pytest.raises(UsageError, match="paused"):
        UsageStore(restored).admit(uuid4(), "connection_test")
