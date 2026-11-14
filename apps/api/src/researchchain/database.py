"""Explicit migrations and short-lived Postgres connections; no credentials in logs."""

import hashlib
import os
import re
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from langgraph.checkpoint.postgres import PostgresSaver
from psycopg import Connection, connect, sql
from psycopg.rows import DictRow, dict_row

LOCAL_DATABASE_URL = "postgresql://researchchain:researchchain-local@127.0.0.1:5433/researchchain"
MIGRATION_LOCK = 726320023


@dataclass(frozen=True)
class Database:
    url: str = field(default=LOCAL_DATABASE_URL, repr=False)
    schema: str = "public"

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", self.schema):
            raise ValueError("DATABASE_SCHEMA must be a simple lowercase SQL identifier.")

    @classmethod
    def from_env(cls) -> "Database":
        load_dotenv(Path(__file__).resolve().parents[4] / ".env", override=False)
        return cls(
            url=os.environ.get("DATABASE_URL", LOCAL_DATABASE_URL),
            schema=os.environ.get("DATABASE_SCHEMA", "public"),
        )

    @contextmanager
    def connection(self) -> Iterator[Connection[DictRow]]:
        # A run's advisory lock and checkpointer share this physical connection.
        # Never reconnect transparently or return a locked session to a pool.
        with connect(
            self.url,
            autocommit=True,
            row_factory=dict_row,
            prepare_threshold=0,
            connect_timeout=3,
            options="-c statement_timeout=15000 -c lock_timeout=10000",
        ) as conn:
            conn.execute("SELECT set_config('search_path', %s, false)", (self.schema,))
            yield conn

    def migrate(self) -> None:
        with self.connection() as conn:
            conn.execute("SELECT pg_advisory_lock(%s)", (MIGRATION_LOCK,))
            conn.execute(
                sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(self.schema))
            )
            conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations "
                "(name text PRIMARY KEY, checksum text NOT NULL, "
                "applied_at timestamptz NOT NULL DEFAULT now())"
            )
            applied = {
                row["name"]: row["checksum"]
                for row in conn.execute("SELECT name, checksum FROM schema_migrations")
            }
            expected = {name: checksum for name, checksum, _ in migrations()}
            if any(expected.get(name) != checksum for name, checksum in applied.items()):
                raise RuntimeError(
                    "Applied migrations differ from this checkout. Restore compatible code."
                )
            for name, checksum, statement in migrations():
                if name not in applied:
                    with conn.transaction():
                        conn.execute(statement, prepare=False)
                        conn.execute(
                            "INSERT INTO schema_migrations (name, checksum) VALUES (%s, %s)",
                            (name, checksum),
                        )
            # The upstream checkpointer has its own append-only migration list.
            # Its concurrent indexes require autocommit, outside our transactions.
            PostgresSaver(conn).setup()
            self.check_ready(conn)

    def check_ready(self, conn: Connection[DictRow]) -> None:
        applied = {
            row["name"]: row["checksum"]
            for row in conn.execute("SELECT name, checksum FROM schema_migrations")
        }
        expected = {name: checksum for name, checksum, _ in migrations()}
        checkpoint_versions = [
            row["v"] for row in conn.execute("SELECT v FROM checkpoint_migrations ORDER BY v")
        ]
        if applied != expected or checkpoint_versions != list(range(len(PostgresSaver.MIGRATIONS))):
            raise RuntimeError("Database migrations are incompatible. Run pnpm db:migrate.")

    def ready(self) -> None:
        with self.connection() as conn:
            self.check_ready(conn)


@lru_cache
def migrations() -> tuple[tuple[str, str, str], ...]:
    result = []
    for path in sorted(Path(__file__).with_name("migrations").glob("*.sql")):
        # Normalize line endings so Windows and Linux verify the same checksum.
        statement = path.read_text(encoding="utf-8")
        result.append((path.name, hashlib.sha256(statement.encode()).hexdigest(), statement))
    return tuple(result)


if __name__ == "__main__":
    Database.from_env().migrate()
    print("Postgres schema and LangGraph checkpoints are ready.")
