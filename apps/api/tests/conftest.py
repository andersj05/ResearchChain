import json
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from psycopg import sql

from researchchain.database import LOCAL_DATABASE_URL, Database
from researchchain.main import create_app


@pytest.fixture
def workflow() -> dict[str, Any]:
    path = Path(__file__).resolve().parents[3] / "examples/research-workflow.json"
    return json.loads(path.read_text(encoding="utf-8"))  # type: ignore[no-any-return]


@pytest.fixture
def database() -> Iterator[Database]:
    Database.from_env()  # Load .env without overriding the test runner's environment.
    database = Database(
        url=os.environ.get("TEST_DATABASE_URL", LOCAL_DATABASE_URL),
        schema=f"test_{uuid4().hex}",
    )
    try:
        database.migrate()
        yield database
    finally:
        # Only this fixture's randomly named schema can be removed, never public.
        assert database.schema.startswith("test_") and len(database.schema) == 37
        with database.connection() as conn:
            conn.execute(
                sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(database.schema))
            )


@pytest.fixture
def client(database: Database) -> Iterator[TestClient]:
    with TestClient(create_app(database)) as client:
        yield client


@pytest.fixture
def restore_target(database: Database) -> Iterator[str]:
    name = "test_restore_" + uuid4().hex
    try:
        yield name
    finally:
        assert name.startswith("test_restore_") and len(name) == 45
        with database.connection() as conn:
            owner = conn.execute(
                "SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=%s",
                (name,),
            ).fetchone()
            conn.execute(
                sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name))
            )
            if owner and owner["owner"].startswith("rc_restore_"):
                conn.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(owner["owner"])))
