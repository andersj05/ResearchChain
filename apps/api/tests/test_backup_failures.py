"""Failure recovery cannot overwrite the source or silently repeat provider work."""

import hashlib
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo
from test_research_runtime import FakeProvider, setup_run

from researchchain.artifacts import put_artifact, read_content
from researchchain.backup import create_backup
from researchchain.backup_files import MANIFEST
from researchchain.backup_models import BackupError
from researchchain.backup_restore import restore_backup
from researchchain.backup_tools import PostgreSQLTools
from researchchain.database import MIGRATION_LOCK, Database, migrations
from researchchain.runtime import RunStore


def test_failed_restore_is_quarantined_and_source_is_unchanged(
    database: Database,
    tmp_path: Path,
    restore_target: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with database.connection() as conn:
        original = put_artifact(conn, b"source survives failed restore", "source.txt")
    directory = tmp_path / "backup"
    manifest = create_backup(database, directory)
    data = manifest.model_dump(mode="json")
    data["inventory"]["tables"]["artifact_blobs"]["sha256"] = "0" * 64
    (directory / MANIFEST).write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(BackupError, match="quarantined"):
        restore_backup(database, directory, restore_target, trusted=True)
    with database.connection() as conn:
        assert read_content(conn, original.id) == b"source survives failed restore"
        state = conn.execute(
            "SELECT d.datallowconn,r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole "
            "FROM pg_database d JOIN pg_roles r ON d.datdba=r.oid WHERE datname=%s",
            (restore_target,),
        ).fetchone()
        assert state and all(value is False for value in state.values())
    with pytest.raises(BackupError, match="already exists"):
        restore_backup(database, directory, restore_target, trusted=True)


def test_dump_failure_never_publishes_complete_manifest(
    database: Database,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run = PostgreSQLTools.run

    def fail_dump(self: PostgreSQLTools, tool: str, *args: Any, **kwargs: Any) -> bytes:
        if tool == "pg_dump" and "--version" not in args[1]:
            kwargs["destination"].write(b"PGDMP incomplete")
            raise BackupError("Synthetic client failure.")
        return run(self, tool, *args, **kwargs)

    monkeypatch.setattr(PostgreSQLTools, "run", fail_dump)
    directory = tmp_path / "backup"
    with pytest.raises(BackupError, match="Synthetic"):
        create_backup(database, directory)
    assert not (directory / MANIFEST).exists()


def test_live_uncertain_provider_attempt_is_never_resent_after_restore(
    database: Database,
    tmp_path: Path,
    restore_target: str,
) -> None:
    store, request, provider = setup_run(database)
    provider.block = True
    with ThreadPoolExecutor(max_workers=1) as executor:
        ongoing = executor.submit(store.start, request)
        try:
            assert provider.started.wait(timeout=10)
            directory = tmp_path / "backup"
            create_backup(database, directory)
        finally:
            provider.released.set()
        assert ongoing.result(timeout=10).status == "paused"
    assert len(provider.calls) == 1
    restore_backup(database, directory, restore_target, trusted=True)
    restored = Database(make_conninfo(database.url, dbname=restore_target), database.schema)
    replacement_provider = FakeProvider()
    restored_store = RunStore(restored, replacement_provider)
    assert restored_store.get(request.id).status == "interrupted"
    recovered = restored_store.recover(request.id)
    assert recovered.status == "failed"
    assert recovered.model_attempts[0].status == "unknown"
    assert "will not be resent" in recovered.stop_reason
    assert replacement_provider.calls == []
    assert store.get(request.id).status == "paused"


def test_public_schema_and_partial_upgrade_restore_compatible_code(
    database: Database,
    tmp_path: Path,
    restore_target: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # This newly created database is owned by the fixture and can safely host public.
    with database.connection() as conn:
        conn.execute(
            sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(sql.Identifier(restore_target))
        )
    source = Database(make_conninfo(database.url, dbname=restore_target), "public")
    source.migrate()
    with source.connection() as conn:
        put_artifact(conn, b"pre-upgrade original", "original.txt")
    directory = tmp_path / "backup"
    create_backup(source, directory)
    known = migrations()
    statements = (
        ("0008_synthetic_upgrade.sql", "CREATE TABLE simulated_upgrade(id integer)"),
        ("0009_synthetic_failure.sql", "CREATE TABLE rolled_back(id integer); SELECT 1/0;"),
    )
    extra = tuple(
        (name, hashlib.sha256(statement.encode()).hexdigest(), statement)
        for name, statement in statements
    )
    with monkeypatch.context() as patch:
        patch.setattr("researchchain.database.migrations", lambda: known + extra)
        with pytest.raises(psycopg.errors.DivisionByZero):
            source.migrate()
    with source.connection() as conn:
        assert conn.execute("SELECT to_regclass('public.simulated_upgrade') AS id").fetchone()["id"]
        assert not conn.execute("SELECT to_regclass('public.rolled_back') AS id").fetchone()["id"]
    with pytest.raises(RuntimeError, match="incompatible"):
        source.ready()
    # Drop only this fixture-owned database, then restore under its explicitly new name.
    with database.connection() as conn:
        assert restore_target.startswith("test_restore_")
        conn.execute(
            sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(restore_target))
        )
    receipt = restore_backup(database, directory, restore_target, trusted=True)
    assert receipt.schema_name == "public" and receipt.original_count == 1
    source.ready()


def test_backup_waits_for_migration_before_taking_snapshot(
    database: Database,
    tmp_path: Path,
) -> None:
    with database.connection() as control, ThreadPoolExecutor(max_workers=1) as executor:
        control.execute("SELECT pg_advisory_lock(%s)", (MIGRATION_LOCK,))
        pending = executor.submit(create_backup, database, tmp_path / "backup")
        try:
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                waiting = control.execute(
                    "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() "
                    "AND query LIKE 'SELECT pg_try_advisory_lock_shared%' "
                    "AND state='idle' AND backend_xmin IS NULL"
                ).fetchone()
                if waiting:
                    break
                if pending.done():
                    pending.result()
                    pytest.fail("Backup did not wait for the migration lock.")
                time.sleep(0.05)
            else:
                pytest.fail("Backup never reached the migration lock.")
            # An index migration may wait for old snapshots. A lock waiter must
            # not retain a snapshot that makes this owner wait for the waiter.
            control.execute(
                "CREATE INDEX CONCURRENTLY backup_migration_probe ON artifact_blobs ((lower(name)))"
            )
            put_artifact(control, b"committed before migration unlock", "during-migration.txt")
        finally:
            control.execute("SELECT pg_advisory_unlock(%s)", (MIGRATION_LOCK,))
        manifest = pending.result(timeout=15)
    assert manifest.inventory.artifact_count == 1
