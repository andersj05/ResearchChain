"""Run browser tests in isolated research and owner-access namespaces."""

import os
import secrets
import subprocess
import sys
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from psycopg import sql
from researchchain.access_config import AccessConfig
from researchchain.access_service import AccessService
from researchchain.database import LOCAL_DATABASE_URL, Database

Database.from_env()
database = Database(
    url=os.environ.get("TEST_DATABASE_URL", LOCAL_DATABASE_URL),
    schema=f"e2e_{uuid4().hex}",
)
try:
    database.migrate()
    with TemporaryDirectory(prefix="researchchain-browser-access-") as directory:
        config = AccessConfig.from_env(database)
        access = AccessService(
            replace(
                config,
                directory=Path(directory) / config.workspace_id,
                origin="http://127.0.0.1:3000",
            )
        )
        password = "synthetic-" + secrets.token_urlsafe(24)
        issued = access.exchange(
            access.issue_link("Synthetic owner").get_secret_value()
        )
        access.set_password(issued.token.get_secret_value(), password)
        access.revoke(all_sessions=True)
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
                "RESEARCHCHAIN_ACCESS_DIRECTORY": directory,
                "RESEARCHCHAIN_PUBLIC_ORIGIN": access.config.origin,
                "RESEARCHCHAIN_TEST_OWNER_PASSWORD": password,
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
