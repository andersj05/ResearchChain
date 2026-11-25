"""Run browser tests in isolated research and owner-access namespaces."""

import os
import secrets
import socket
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


def browser_ports() -> tuple[int, int]:
    if os.environ.get("CI"):
        # CI builds the frontend before starting the test runner.
        return 3000, 8000
    with socket.socket() as web, socket.socket() as api:
        web.bind(("127.0.0.1", 0))
        api.bind(("127.0.0.1", 0))
        return web.getsockname()[1], api.getsockname()[1]


Database.from_env()
local_build = "--production" in sys.argv[1:] and not os.environ.get("CI")
browser_arguments = [option for option in sys.argv[1:] if option != "--production"]
pnpm = "pnpm.cmd" if os.name == "nt" else "pnpm"
web_port, api_port = browser_ports()
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
                origin=f"http://127.0.0.1:{web_port}",
            )
        )
        password = "synthetic-" + secrets.token_urlsafe(24)
        issued = access.exchange(
            access.issue_link("Synthetic owner").get_secret_value()
        )
        access.set_password(issued.token.get_secret_value(), password)
        access.revoke(all_sessions=True)
        environment = {
            **os.environ,
            "DATABASE_URL": database.url,
            "DATABASE_SCHEMA": database.schema,
            "RESEARCHCHAIN_ACCESS_DIRECTORY": directory,
            "RESEARCHCHAIN_PUBLIC_ORIGIN": access.config.origin,
            "RESEARCHCHAIN_TEST_OWNER_PASSWORD": password,
            "RESEARCHCHAIN_BROWSER_WEB_PORT": str(web_port),
            "RESEARCHCHAIN_BROWSER_API_PORT": str(api_port),
        }
        if local_build:
            environment["RESEARCHCHAIN_BROWSER_USE_BUILD"] = "1"
            subprocess.run([pnpm, "build"], env=environment, check=True)
        worker = subprocess.Popen(
            [sys.executable, "apps/api/tests/research_browser_fixture.py"],
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=int(getattr(subprocess, "CREATE_NO_WINDOW", 0)),
        )
        try:
            result = subprocess.run(
                [
                    pnpm,
                    "--filter",
                    "@researchchain/web",
                    "test:e2e",
                    *browser_arguments,
                ],
                env=environment,
                check=False,
            )
            if worker.poll() is not None:
                raise RuntimeError("Synthetic browser worker exited unexpectedly.")
        finally:
            worker.terminate()
            try:
                worker.wait(timeout=10)
            except subprocess.TimeoutExpired:
                worker.kill()
                worker.wait(timeout=10)

finally:
    assert database.schema.startswith("e2e_") and len(database.schema) == 36
    with database.connection() as conn:
        conn.execute(
            sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(
                sql.Identifier(database.schema)
            )
        )
raise SystemExit(result.returncode)
