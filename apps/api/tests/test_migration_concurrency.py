"""Migration lock waiters must not block the owner's concurrent indexes."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

from psycopg import sql

from researchchain.database import Database


def test_concurrent_fresh_migrations_finish_without_snapshot_deadlock(database: Database) -> None:
    targets = [Database(database.url, "test_" + uuid4().hex) for _ in range(3)]
    start = Barrier(len(targets))

    def migrate(target: Database) -> None:
        start.wait(timeout=5)
        target.migrate()
        target.ready()

    try:
        with ThreadPoolExecutor(max_workers=len(targets)) as executor:
            futures = [executor.submit(migrate, target) for target in targets]
            for future in futures:
                future.result(timeout=20)
    finally:
        with database.connection() as conn:
            for target in targets:
                assert target.schema.startswith("test_") and len(target.schema) == 37
                conn.execute(
                    sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(
                        sql.Identifier(target.schema)
                    )
                )
