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
