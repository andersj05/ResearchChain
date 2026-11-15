"""Matching PostgreSQL clients with binary streams and redacted failures."""

import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO
from uuid import uuid4

from psycopg.conninfo import conninfo_to_dict

from researchchain.backup_models import BackupError
from researchchain.database import Database

ROOT = Path(__file__).resolve().parents[4]
TIMEOUT = 300
PARAMETERS = {
    "host": "PGHOST",
    "hostaddr": "PGHOSTADDR",
    "port": "PGPORT",
    "dbname": "PGDATABASE",
    "user": "PGUSER",
    "password": "PGPASSWORD",
    "sslmode": "PGSSLMODE",
    "sslcert": "PGSSLCERT",
    "sslkey": "PGSSLKEY",
    "sslrootcert": "PGSSLROOTCERT",
    "sslcrl": "PGSSLCRL",
    "channel_binding": "PGCHANNELBINDING",
    "connect_timeout": "PGCONNECT_TIMEOUT",
}


def connection_environment(
    database: Database, *, container: bool, application: str
) -> dict[str, str]:
    values = conninfo_to_dict(database.url)
    if values.keys() - PARAMETERS.keys():
        raise BackupError("The database URL contains unsupported backup connection options.")
    if not all(values.get(key) for key in ("host", "dbname", "user")):
        raise BackupError("Backups require an explicit database host, database name and user.")
    environment = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
    environment.update(
        {PARAMETERS[key]: str(value) for key, value in values.items() if value is not None}
    )
    environment.update(
        {
            "PGAPPNAME": application,
            "PGCONNECT_TIMEOUT": "5",
            "PGCLIENTENCODING": "UTF8",
            "PGPASSFILE": "/dev/null" if container else os.devnull,
            "PGSERVICEFILE": "/dev/null" if container else os.devnull,
        }
    )
    if container:
        if values["host"] not in {"127.0.0.1", "localhost", "::1"}:
            raise BackupError("Docker backup clients only support the local Postgres instance.")
        if any(key.startswith("ssl") or key in {"hostaddr", "channel_binding"} for key in values):
            raise BackupError("Use native PostgreSQL clients for custom TLS connection settings.")
        environment.update(PGHOST="127.0.0.1", PGPORT="5432")
    return environment


def execute(
    command: list[str],
    *,
    environment: dict[str, str] | None = None,
    source: BinaryIO | None = None,
    destination: BinaryIO | None = None,
) -> bytes:
    try:
        result = subprocess.run(
            command,
            cwd=ROOT,
            env=environment,
            stdin=source or subprocess.DEVNULL,
            stdout=destination or subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=TIMEOUT,
            check=False,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise BackupError(
            "A PostgreSQL client could not finish within the operation limit."
        ) from None
    # Diagnostics can contain SQL, source text and credentials. Never forward them.
    if result.returncode or result.stderr:
        raise BackupError(
            "A PostgreSQL client failed; no successful backup or restore was recorded."
        )
    return result.stdout or b""


@dataclass(frozen=True)
class PostgreSQLTools:
    major: int
    container: str | None = None
    dump_path: str = "pg_dump"
    restore_path: str = "pg_restore"

    def command(self, tool: str, args: list[str], environment: dict[str, str]) -> list[str]:
        if self.container:
            env_args = [
                item
                for key in sorted(environment)
                if key.startswith("PG")
                for item in ("--env", key)
            ]
            return ["docker", "exec", "-i", *env_args, self.container, tool, *args]
        executable = self.dump_path if tool == "pg_dump" else self.restore_path
        return [executable, *args]

    def run(
        self,
        tool: str,
        database: Database,
        args: list[str],
        *,
        source: BinaryIO | None = None,
        destination: BinaryIO | None = None,
    ) -> bytes:
        application = f"researchchain_backup_{uuid4().hex}"
        environment = connection_environment(
            database,
            container=self.container is not None,
            application=application,
        )
        try:
            return execute(
                self.command(tool, args, environment),
                environment=environment,
                source=source,
                destination=destination,
            )
        except BaseException:
            # A killed Docker CLI can leave its client running in the container.
            # Cancel only this operation's uniquely named database sessions.
            try:
                with database.connection() as conn:
                    conn.execute(
                        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                        "WHERE application_name=%s AND datname=current_database() "
                        "AND pid<>pg_backend_pid()",
                        (application,),
                    )
            except Exception:
                pass  # Preserve the redacted original failure.
            raise

    @classmethod
    def select(cls, database: Database) -> "PostgreSQLTools":
        with database.connection() as conn:
            major = conn.info.server_version // 10000
            container = os.environ.get("RESEARCHCHAIN_PG_CONTAINER")
            dump, restore = shutil.which("pg_dump"), shutil.which("pg_restore")
            if not container and dump and restore:
                native = cls(major, dump_path=dump, restore_path=restore)
                try:
                    native.check_versions(database)
                    return native
                except BackupError:
                    pass
            if not container:
                container = (
                    execute(["docker", "compose", "ps", "--quiet", "postgres"]).decode().strip()
                )
            if not re.fullmatch(r"[a-f0-9]{12,64}", container or ""):
                raise BackupError(
                    "Matching PostgreSQL clients or a running local container are required."
                )
            selected = cls(major, container=container)
            selected.check_versions(database)
            identity = conn.execute("SELECT system_identifier FROM pg_control_system()").fetchone()
            environment = connection_environment(
                database,
                container=True,
                application="researchchain_backup_preflight",
            )
            actual = (
                execute(
                    selected.command(
                        "psql",
                        [
                            "-X",
                            "-A",
                            "-t",
                            "-c",
                            "SELECT system_identifier FROM pg_control_system()",
                        ],
                        environment,
                    ),
                    environment=environment,
                )
                .decode()
                .strip()
            )
            if not identity or actual != str(identity["system_identifier"]):
                raise BackupError(
                    "The Docker client is not connected to the selected database server."
                )
            return selected

    def check_versions(self, database: Database) -> None:
        for tool in ("pg_dump", "pg_restore"):
            output = self.run(tool, database, ["--version"]).decode("ascii", errors="replace")
            match = re.search(r"PostgreSQL\) (\d+)\.", output)
            if not match or int(match[1]) != self.major:
                raise BackupError(
                    "PostgreSQL backup clients must match the server's major version."
                )
