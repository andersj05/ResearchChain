"""Hold worker slots only in an isolated browser-test database."""

import sys
import time

from researchchain.database import Database
from researchchain.dispatch import slot_key

database = Database.from_env()
if not database.schema.startswith("e2e_") or len(database.schema) != 36:
    raise RuntimeError("Worker browser controls require an isolated e2e schema.")
deadline = time.monotonic() + 20
while time.monotonic() < deadline:
    with database.connection() as conn:
        acquired = True
        for slot in range(8):
            row = conn.execute(
                "SELECT pg_try_advisory_lock(hashtextextended(%s, 0)) AS acquired",
                (slot_key(database, slot),),
            ).fetchone()
            if not row or not row["acquired"]:
                acquired = False
                break
        if acquired:
            print("ready", flush=True)
            sys.stdin.readline()
            break
    time.sleep(0.05)
else:
    raise RuntimeError("Synthetic workers did not become idle.")
