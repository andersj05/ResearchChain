"""Restore a trusted archive using a temporary restricted database owner."""

import re
import secrets
from datetime import UTC, datetime
from pathlib import Path
from typing import BinaryIO
from uuid import uuid4

import portalocker
from psycopg import Connection, sql
from psycopg.conninfo import make_conninfo
from psycopg.rows import DictRow

from researchchain.backup import check_compatibility
from researchchain.backup_files import ARCHIVE, read_manifest, verify_archive
from researchchain.backup_inventory import compare_inventory, inventory
from researchchain.backup_models import BackupError, BackupManifest, RestoreReceipt
from researchchain.backup_tools import TIMEOUT, PostgreSQLTools
from researchchain.database import Database


def quarantine(conn: Connection[DictRow], target: str, role: str, created: bool) -> None:
    conn.execute(sql.SQL("ALTER ROLE {} NOLOGIN PASSWORD NULL").format(sql.Identifier(role)))
    if created:
        conn.execute(
            sql.SQL("ALTER DATABASE {} ALLOW_CONNECTIONS false").format(sql.Identifier(target))
        )
        conn.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=%s",
            (target,),
        )
    else:
        conn.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(role)))


def restore_backup(
    admin: Database,
    directory: Path,
    target: str,
    *,
    trusted: bool = False,
) -> RestoreReceipt:
    if not trusted:
        raise BackupError("Only restore trusted backups; explicitly pass --trust-source.")
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", target):
        raise BackupError("The target must be a simple lowercase database name (1–63 characters).")
    if target in {"postgres", "template0", "template1"}:
        raise BackupError("System databases cannot be restore targets.")
    manifest = read_manifest(directory)
    check_compatibility(manifest)
    # Keep the same binary handle open from hashing through restore. No shell pipe
    # or reopened archive can change the bytes between these phases.
    with (directory / ARCHIVE).open("rb") as source:
        portalocker.lock(source, portalocker.LOCK_SH | portalocker.LOCK_NB)
        try:
            verify_archive(source, manifest)
            return restore_verified(admin, source, manifest, target)
        finally:
            portalocker.unlock(source)


def restore_verified(
    admin: Database,
    source: BinaryIO,
    manifest: BackupManifest,
    target: str,
) -> RestoreReceipt:
    tools = PostgreSQLTools.select(admin)
    if tools.major != manifest.client_major:
        raise BackupError("Restore requires the same PostgreSQL major version as the backup.")
    role = f"rc_restore_{uuid4().hex}"
    password = secrets.token_urlsafe(48)
    created_role = False
    created_database = False
    verified = False
    with admin.connection() as control:
        owner = control.execute(
            "SELECT current_user AS name,current_database() AS database"
        ).fetchone()
        assert owner
        if target == owner["database"]:
            raise BackupError("The connected database cannot be a restore target.")
        if control.execute("SELECT 1 FROM pg_database WHERE datname=%s", (target,)).fetchone():
            raise BackupError("The restore target already exists; choose a new database name.")
        phase = "target preparation"
        try:
            control.execute(
                sql.SQL(
                    "CREATE ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE "
                    "NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD {}"
                ).format(sql.Identifier(role), sql.Literal(password))
            )
            created_role = True
            control.execute(
                sql.SQL("GRANT {} TO {}").format(
                    sql.Identifier(role), sql.Identifier(owner["name"])
                )
            )
            control.execute(
                sql.SQL("CREATE DATABASE {} OWNER {} TEMPLATE template0").format(
                    sql.Identifier(target), sql.Identifier(role)
                )
            )
            created_database = True
            restricted = Database(
                make_conninfo(admin.url, dbname=target, user=role, password=password),
                manifest.schema_name,
            )
            # Connect as the restricted owner, not an admin session with SET ROLE.
            # --create/--clean are deliberately absent: the archive cannot choose a target.
            if manifest.schema_name == "public":
                # template0 creates an empty public schema. Remove only that
                # fresh empty schema; pg_restore recreates the archived one.
                with restricted.connection() as conn:
                    conn.execute("DROP SCHEMA public")
            phase = "archive execution"
            tools.run(
                "pg_restore",
                restricted,
                [
                    "--dbname",
                    target,
                    "--single-transaction",
                    "--no-owner",
                    "--no-acl",
                    "--no-tablespaces",
                    "--exit-on-error",
                    "--no-password",
                ],
                source=source,
            )
            phase = "snapshot verification"
            with restricted.connection() as conn, conn.transaction():
                conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
                conn.execute(
                    "SELECT set_config('statement_timeout',%s,true)", (str(TIMEOUT * 1000),)
                )
                restricted.check_ready(conn)
                actual = inventory(conn, manifest.schema_name)
                compare_inventory(manifest.inventory, actual)
            phase = "ownership finalization"
            restored_admin = Database(make_conninfo(admin.url, dbname=target), manifest.schema_name)
            with restored_admin.connection() as conn:
                conn.execute(
                    sql.SQL("REASSIGN OWNED BY {} TO {}").format(
                        sql.Identifier(role), sql.Identifier(owner["name"])
                    )
                )
            control.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(role)))
            created_role = False
            verified = True
            return RestoreReceipt(
                backup_id=manifest.id,
                target_database=target,
                schema_name=manifest.schema_name,
                archive_sha256=manifest.archive_sha256,
                verified_at=datetime.now(UTC),
                tables=len(actual.tables),
                rows=sum(t.rows for t in actual.tables.values()),
                original_count=actual.artifact_count,
                original_bytes=actual.artifact_bytes,
            )
        except BaseException:
            if created_role and not verified:
                try:
                    quarantine(control, target, role, created_database)
                except Exception:
                    raise BackupError(
                        "Restore failed and cleanup was incomplete. Inspect the new target "
                        "and rc_restore_ role before retrying; do not start the application."
                    ) from None
            if created_database:
                raise BackupError(
                    f"Restore failed during {phase}. "
                    "The new target is quarantined with connections "
                    "disabled; its temporary role cannot log in. No existing database was replaced."
                ) from None
            raise
