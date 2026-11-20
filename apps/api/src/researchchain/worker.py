"""Explicit bounded workers using the same physical connection as checkpoint writes."""

import argparse
import logging
import signal
from concurrent.futures import FIRST_EXCEPTION, ThreadPoolExecutor, wait
from threading import Event
from uuid import UUID, uuid4

import psycopg
from psycopg import Connection
from psycopg.rows import DictRow

from researchchain.database import Database
from researchchain.dispatch import RunQueue, presence_key, queue_limits, slot_key
from researchchain.dispatch_models import DispatchError, QueueLimits
from researchchain.runtime import RunStore

LOG = logging.getLogger(__name__)
MAX_AUTOMATIC_ATTEMPTS = 3
INTERRUPTED = "Worker execution stopped unexpectedly. Recover from the saved checkpoint."


class RunWorker:
    def __init__(self, runs: RunStore) -> None:
        self.runs = runs
        self.database = runs.database
        self.owner_id = uuid4()

    @staticmethod
    def _try_lock(conn: Connection[DictRow], key: str) -> bool:
        row = conn.execute(
            "SELECT pg_try_advisory_lock(hashtextextended(%s, 0)) AS acquired", (key,)
        ).fetchone()
        assert row
        return bool(row["acquired"])

    @staticmethod
    def _interrupt(conn: Connection[DictRow], command_id: UUID, message: str) -> None:
        conn.execute(
            "UPDATE run_jobs SET state = 'interrupted', owner_id = NULL, last_error = %s "
            "WHERE command_id = %s",
            (message, command_id),
        )

    @staticmethod
    def _finish(conn: Connection[DictRow], command_id: UUID) -> None:
        conn.execute(
            "UPDATE run_jobs SET state = 'finished', owner_id = NULL, last_error = NULL, "
            "finished_at = clock_timestamp() WHERE command_id = %s",
            (command_id,),
        )

    def _claim(self, conn: Connection[DictRow], command_id: UUID) -> bool:
        with conn.transaction():
            job = conn.execute(
                "SELECT j.*, c.response FROM run_jobs j JOIN run_commands c "
                "ON c.id = j.command_id WHERE command_id = %s FOR UPDATE OF j",
                (command_id,),
            ).fetchone()
            if not job or job["state"] not in {"queued", "running"}:
                return False
            if job["response"] is not None:
                self._finish(conn, command_id)
                return False
            if job["generation_attempts"] >= MAX_AUTOMATIC_ATTEMPTS:
                self._interrupt(
                    conn,
                    command_id,
                    "Worker ownership was lost repeatedly. Inspect the worker before recovery.",
                )
                return False
            conn.execute(
                "UPDATE run_jobs SET state = 'running', owner_id = %s, attempts = attempts + 1, "
                "generation_attempts = generation_attempts + 1, claimed_at = clock_timestamp(), "
                "last_error = NULL WHERE command_id = %s",
                (self.owner_id, command_id),
            )
            return True

    def run_once(self) -> bool:
        # One connection owns both the workspace slot and run lock for the entire
        # execution. Never reconnect a running command after losing this session.
        with self.database.connection() as conn:
            limits = queue_limits(conn)
            for slot in range(limits.max_parallel):
                if self._try_lock(conn, slot_key(self.database, slot)):
                    break
            else:
                return False
            # A concurrent operator may have lowered limits since the first read.
            if slot >= queue_limits(conn).max_parallel:
                return False
            candidates = conn.execute(
                "SELECT j.command_id, c.run_id FROM run_jobs j "
                "JOIN run_commands c ON c.id = j.command_id "
                "WHERE j.state IN ('queued', 'running') "
                "ORDER BY j.queued_at, j.command_id LIMIT 64"
            ).fetchall()
            for candidate in candidates:
                run_id, command_id = candidate["run_id"], candidate["command_id"]
                key = f"run:{run_id}"
                if not self._try_lock(conn, key):
                    continue
                try:
                    if not self._claim(conn, command_id):
                        continue
                    try:
                        command = conn.execute(
                            "SELECT * FROM run_commands WHERE id = %s", (command_id,)
                        ).fetchone()
                        assert command
                        self.runs._drive(conn, self.runs._manifest(conn, run_id), command)
                        self._finish(conn, command_id)
                    except Exception:
                        # No provider content, input, credentials or raw exception is logged.
                        # If the connection is lost this write also fails; a later worker
                        # arbitrates ownership on a new connection and inspects the journal.
                        self._interrupt(conn, command_id, INTERRUPTED)
                        LOG.warning("Research worker stopped a command. Recovery is available.")
                    return True
                finally:
                    if not conn.closed:
                        conn.execute("SELECT pg_advisory_unlock(hashtextextended(%s, 0))", (key,))
            return False

    def serve(self, stop: Event, poll_seconds: float = 0.5) -> None:
        outage_logged = False
        while not stop.is_set():
            try:
                # Independent presence session: never reuse or reconnect the
                # physical connection fencing an executing command/checkpoint.
                with self.database.connection() as presence:
                    presence.execute(
                        "SELECT pg_advisory_lock_shared(hashtextextended(%s, 0))",
                        (presence_key(self.database),),
                    )
                    while not stop.is_set():
                        presence.execute("SELECT 1")
                        worked = self.run_once()
                        outage_logged = False
                        if not worked:
                            stop.wait(poll_seconds)
            except psycopg.Error:
                if not outage_logged:
                    LOG.warning("Research worker database connection failed; polling will retry.")
                    outage_logged = True
                stop.wait(poll_seconds)


def main(argv: list[str] | None = None, *, runs: RunStore | None = None) -> int:
    parser = argparse.ArgumentParser(description="ResearchChain durable worker")
    parser.add_argument("command", choices=["run", "status", "configure"], nargs="?", default="run")
    parser.add_argument("--once", action="store_true", help="Process at most one available command")
    parser.add_argument("--max-parallel", type=int, default=2)
    parser.add_argument("--max-pending", type=int, default=100)
    args = parser.parse_args(argv)
    try:
        database = runs.database if runs else Database.from_env()
        database.ready()
        runs = runs or RunStore(database)
        if args.command == "configure":
            RunQueue(runs).configure(
                QueueLimits(max_parallel=args.max_parallel, max_pending=args.max_pending)
            )
            print("Workspace worker limits updated.")
            return 0
        with database.connection() as conn:
            limits = queue_limits(conn)
        if args.command == "status":
            print(f"Parallel commands: {limits.max_parallel}; pending limit: {limits.max_pending}")
            with database.connection() as conn:
                for row in conn.execute(
                    "SELECT state, count(*) AS count FROM run_jobs GROUP BY state ORDER BY state"
                ):
                    print(f"{row['state']}: {row['count']}")
            return 0
        if args.once:
            RunWorker(runs).run_once()
            return 0
        stop = Event()
        signal.signal(signal.SIGINT, lambda *_: stop.set())
        signal.signal(signal.SIGTERM, lambda *_: stop.set())
        print(f"Worker ready with {limits.max_parallel} workspace slots.", flush=True)
        with ThreadPoolExecutor(max_workers=limits.max_parallel) as executor:
            futures = [
                executor.submit(RunWorker(runs).serve, stop) for _ in range(limits.max_parallel)
            ]
            try:
                done, _ = wait(futures, return_when=FIRST_EXCEPTION)
                for future in done:
                    future.result()
            finally:
                stop.set()
        print("Worker stopped after finishing active commands.")
        return 0
    except DispatchError as error:
        print(str(error))
    except (ValueError, psycopg.Error, RuntimeError):
        print("Worker setup failed. Check database availability, migrations and limits.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
