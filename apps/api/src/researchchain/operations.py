"""Read-only workspace aggregates. Never load provider credentials or research text."""

import psycopg

from researchchain.database import Database
from researchchain.dispatch import presence_key, queue_limits
from researchchain.operations_models import (
    OperationsSnapshot,
    QueueOperations,
    StorageOperations,
    UsageOperations,
    WorkerOperations,
)


class OperationsStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    def snapshot(self) -> OperationsSnapshot:
        with self.database.connection() as conn, conn.transaction():
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            limits = queue_limits(conn)
            # Sample advisory locks once. A run reader can hold the run lock too,
            # so execution requires a workspace slot held by the SAME session.
            # These are observations, not a lease or provider health guarantee.
            row = conn.execute(
                """
                WITH locks AS MATERIALIZED (
                    SELECT pid, mode, ((classid::bigint << 32) | objid::bigint) AS key
                    FROM pg_locks WHERE locktype = 'advisory' AND granted AND objsubid = 1
                    AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
                ), slots AS MATERIALIZED (
                    SELECT l.pid FROM locks l
                    JOIN generate_series(0, %(parallel)s - 1) AS s(slot)
                    ON l.key = hashtextextended(%(slot_prefix)s || s.slot::text, 0)
                    WHERE l.mode = 'ExclusiveLock'
                ), jobs AS MATERIALIZED (
                    SELECT j.*,
                        EXISTS (SELECT 1 FROM locks l
                            WHERE l.mode = 'ExclusiveLock'
                            AND l.key = hashtextextended('run:' || c.run_id::text, 0)
                            AND l.pid IN (SELECT pid FROM slots)) AS owned,
                        c.run_id
                    FROM run_jobs j JOIN run_commands c ON c.id = j.command_id
                )
                SELECT transaction_timestamp() AS observed_at,
                    transaction_timestamp() - interval '24 hours' AS window_started_at,
                    (SELECT count(*) FROM locks
                     WHERE mode = 'ShareLock'
                     AND key = hashtextextended(%(presence)s, 0)) AS connected_consumers,
                    (SELECT count(*) FROM slots) AS reserved_slots,
                    (SELECT count(*) FROM jobs WHERE state = 'queued') AS queued,
                    (SELECT count(*) FROM jobs WHERE state = 'running' AND owned) AS executing,
                    (SELECT count(*) FROM jobs WHERE state = 'running' AND NOT owned)
                        AS awaiting_takeover,
                    (SELECT count(*) FROM jobs WHERE state = 'interrupted') AS interrupted,
                    (SELECT count(*) FROM jobs WHERE state = 'finished'
                     AND finished_at >= transaction_timestamp() - interval '24 hours')
                        AS finished_24h,
                    (SELECT greatest(0, extract(epoch FROM
                        transaction_timestamp() - min(queued_at)))
                     FROM jobs WHERE state IN ('queued', 'running')
                     HAVING count(*) > 0) AS oldest_pending_seconds,
                    (SELECT count(*) FROM research_attempts a WHERE a.status = 'unknown'
                        OR (a.status IN ('preparing', 'requesting') AND NOT EXISTS
                            (SELECT 1 FROM jobs j WHERE j.run_id = a.run_id
                             AND j.state = 'running' AND j.owned))) AS uncertain_attempts
                """,
                {
                    "parallel": limits.max_parallel,
                    "slot_prefix": f"worker:{self.database.schema}:",
                    "presence": presence_key(self.database),
                },
            ).fetchone()
            assert row
            storage = conn.execute(
                """
                SELECT (SELECT count(*) FROM runs) AS runs,
                    (SELECT count(*) FROM evidence_records) AS evidence_records,
                    (SELECT count(*) FROM report_revisions) AS report_revisions,
                    (SELECT count(*) FROM evaluation_datasets) AS evaluation_datasets,
                    (SELECT count(*) FROM artifact_blobs) AS originals,
                    (SELECT coalesce(sum(byte_size), 0) FROM artifact_blobs) AS original_bytes,
                    (SELECT coalesce(sum(pg_total_relation_size(c.oid)), 0)
                     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'm'))
                        AS schema_bytes
                """
            ).fetchone()
            usage = conn.execute(
                """
                SELECT count(*) AS attempts_started_24h,
                    coalesce(sum(input_tokens), 0) AS reported_input_tokens_24h,
                    coalesce(sum(output_tokens), 0) AS reported_output_tokens_24h,
                    count(*) FILTER (WHERE input_tokens IS NULL OR output_tokens IS NULL)
                        AS incomplete_usage_24h
                FROM research_attempts WHERE created_at >= %s
                """,
                (row["window_started_at"],),
            ).fetchone()
            assert storage and usage
            return OperationsSnapshot(
                observed_at=row["observed_at"],
                window_started_at=row["window_started_at"],
                workers=WorkerOperations(
                    connected_consumers=row["connected_consumers"],
                    reserved_slots=row["reserved_slots"],
                    **limits.model_dump(),
                ),
                queue=QueueOperations(**{key: row[key] for key in QueueOperations.model_fields}),
                storage=StorageOperations.model_validate(storage),
                usage=UsageOperations(uncertain_attempts=row["uncertain_attempts"], **usage),
            )


def main(*, database: Database | None = None) -> int:
    try:
        database = database or Database.from_env()
        database.ready()
        print(OperationsStore(database).snapshot().model_dump_json(indent=2))
        return 0
    except (psycopg.Error, RuntimeError, ValueError):
        print("Operations unavailable. Check database availability and migrations.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
