"""Run browser tests against an isolated Postgres schema, never the user's runs."""

import os
import subprocess
import sys
from uuid import uuid4

from psycopg import sql
from researchchain.database import LOCAL_DATABASE_URL, Database

Database.from_env()
database = Database(
    url=os.environ.get("TEST_DATABASE_URL", LOCAL_DATABASE_URL),
    schema=f"e2e_{uuid4().hex}",
)
try:
    database.migrate()
    result = subprocess.run(
        [
            "pnpm.cmd" if os.name == "nt" else "pnpm",
            "--filter",
            "@researchchain/web",
            "test:e2e",
            *sys.argv[1:],
        ],
        env={
            **os.environ,
            "DATABASE_URL": database.url,
            "DATABASE_SCHEMA": database.schema,
        },
        check=False,
    )
finally:
    assert database.schema.startswith("e2e_") and len(database.schema) == 36
    with database.connection() as conn:
        conn.execute(
            sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(
                sql.Identifier(database.schema)
            )
        )
raise SystemExit(result.returncode)
