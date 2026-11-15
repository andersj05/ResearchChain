"""Consistent logical backup and an explicit, separate-database restore CLI."""

import argparse
import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from langgraph.checkpoint.postgres import PostgresSaver

from researchchain.backup_files import ARCHIVE, file_digest, private_directory, publish_manifest
from researchchain.backup_inventory import inventory
from researchchain.backup_models import BackupError, BackupManifest
from researchchain.backup_tools import ROOT, TIMEOUT, PostgreSQLTools
from researchchain.database import Database, acquire_migration_lock, migrations


def code_version() -> tuple[str | None, bool]:
    try:
        head = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT,
            capture_output=True,
            timeout=10,
            check=True,
            text=True,
        ).stdout.strip()
        dirty = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=ROOT,
            capture_output=True,
            timeout=10,
            check=True,
            text=True,
        ).stdout
        return head, bool(dirty)
    except (OSError, subprocess.SubprocessError):
        return None, True


def check_compatibility(manifest: BackupManifest) -> None:
    if manifest.migrations != {name: digest for name, digest, _ in migrations()}:
        raise BackupError("This checkout does not match the backup's application migrations.")
    if manifest.checkpoint_migrations != list(range(len(PostgresSaver.MIGRATIONS))):
        raise BackupError("This checkout does not match the backup's checkpoint migrations.")
    if manifest.client_major != manifest.postgres_version // 10000:
        raise BackupError("The backup's PostgreSQL version metadata is inconsistent.")


def create_backup(database: Database, directory: Path) -> BackupManifest:
    tools = PostgreSQLTools.select(database)
    revision, dirty = code_version()
    private_directory(directory)
    with database.connection() as conn:
        # Acquire the migration lock BEFORE opening the MVCC snapshot. A waiting
        # backup must see the migration that finishes before this lock is granted.
        acquire_migration_lock(conn, shared=True)
        with conn.transaction():
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            conn.execute("SELECT set_config('statement_timeout',%s,true)", (str(TIMEOUT * 1000),))
            database.check_ready(conn)
            snapshot = conn.execute("SELECT pg_export_snapshot() AS id").fetchone()
            assert snapshot
            contents = inventory(conn, database.schema)
            with (directory / ARCHIVE).open("x+b") as output:
                if os.name != "nt":
                    (directory / ARCHIVE).chmod(0o600)
                tools.run(
                    "pg_dump",
                    database,
                    [
                        "--format=custom",
                        "--no-owner",
                        "--no-acl",
                        "--strict-names",
                        f"--schema={database.schema}",
                        f"--snapshot={snapshot['id']}",
                        "--lock-wait-timeout=10000",
                        "--no-password",
                    ],
                    destination=output,
                )
                output.flush()
                os.fsync(output.fileno())
                size, digest = file_digest(output)
                if output.read(5) != b"PGDMP":
                    raise BackupError("The backup client did not produce a custom archive.")
            manifest = BackupManifest(
                id=uuid4(),
                created_at=datetime.now(UTC),
                schema_name=database.schema,
                postgres_version=conn.info.server_version,
                client_major=tools.major,
                code_revision=revision,
                code_dirty=dirty,
                migrations={name: checksum for name, checksum, _ in migrations()},
                checkpoint_migrations=list(range(len(PostgresSaver.MIGRATIONS))),
                inventory=contents,
                archive_bytes=size,
                archive_sha256=digest,
            )
    publish_manifest(directory, manifest)
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ResearchChain database backup and tested restore")
    commands = parser.add_subparsers(dest="command", required=True)
    backup = commands.add_parser("create", help="Create a private snapshot in a new directory")
    backup.add_argument("--output", type=Path, required=True)
    restore = commands.add_parser("restore", help="Restore a trusted backup into a NEW database")
    restore.add_argument("--input", type=Path, required=True)
    restore.add_argument("--database", required=True, help="New lowercase database name")
    restore.add_argument(
        "--trust-source",
        action="store_true",
        help="Confirm the archive came from a trusted server; archives contain executable SQL",
    )
    keys = commands.add_parser("keygen", help="Create a passphrase-protected age recovery identity")
    keys.add_argument(
        "--output", type=Path, required=True, help="New private recovery-key directory"
    )
    seal = commands.add_parser(
        "seal", help="Encrypt a complete backup to a public recovery recipient"
    )
    seal.add_argument("--input", type=Path, required=True)
    seal.add_argument("--output", type=Path, required=True, help="New encrypted-package directory")
    seal.add_argument("--recipient", type=Path, required=True, help="Public recipient.txt file")
    unseal = commands.add_parser(
        "unseal", help="Authenticate and unpack a backup into a NEW directory"
    )
    unseal.add_argument("--input", type=Path, required=True, help="Encrypted backup.tar.age file")
    unseal.add_argument("--output", type=Path, required=True)
    unseal.add_argument(
        "--identity", type=Path, required=True, help="Passphrase-protected identity.age"
    )
    args = parser.parse_args(argv)
    try:
        if args.command == "create":
            manifest = create_backup(Database.from_env(), args.output)
            print(manifest.model_dump_json(indent=2))
        elif args.command == "restore":
            from researchchain.backup_restore import restore_backup

            receipt = restore_backup(
                Database.from_env(), args.input, args.database, trusted=args.trust_source
            )
            print(receipt.model_dump_json(indent=2))
        elif args.command == "keygen":
            from researchchain.backup_crypto import create_recovery_key
            from researchchain.backup_prompt import recovery_passphrase

            public = create_recovery_key(args.output, recovery_passphrase(confirm=True))
            print(json.dumps({"format": "researchchain-recovery-key-1", "recipient": public}))
        elif args.command == "seal":
            from researchchain.backup_bundle import seal_backup

            print(json.dumps(seal_backup(args.input, args.output, args.recipient), indent=2))
        else:
            from researchchain.backup_bundle import unseal_backup
            from researchchain.backup_prompt import recovery_passphrase

            manifest = unseal_backup(args.input, args.output, args.identity, recovery_passphrase())
            print(
                json.dumps(
                    {
                        "status": "authenticated_and_unpacked",
                        "backup_id": str(manifest.id),
                        "archive_sha256": manifest.archive_sha256,
                        "database_restored": False,
                        "provider_calls": 0,
                    },
                    indent=2,
                )
            )
        return 0
    except BackupError as error:
        print(f"Backup operation failed: {error}", file=sys.stderr)
    except KeyboardInterrupt:
        print("Backup operation interrupted; no success was recorded.", file=sys.stderr)
    except Exception:
        # Raw libpq, filesystem and validation exceptions can contain secrets.
        print(
            "Backup operation failed. Check database access, client tools and file permissions.",
            file=sys.stderr,
        )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
