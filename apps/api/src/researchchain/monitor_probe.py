"""Read existing health/aggregate interfaces without research effects or credentials."""

from collections.abc import Callable
from datetime import UTC, datetime

import psycopg

from researchchain.database import Database
from researchchain.monitor_http import MonitorHTTP
from researchchain.monitor_models import Condition, MonitorSettings, Observation
from researchchain.operations import OperationsStore


def utcnow() -> datetime:
    return datetime.now(UTC)


def collect_observation(
    database: Database,
    settings: MonitorSettings,
    http: MonitorHTTP,
    clock: Callable[[], datetime] = utcnow,
) -> Observation:
    checks: dict[Condition, bool | None] = dict.fromkeys(Condition)
    checks[Condition.OBSERVATION_UNAVAILABLE] = False
    try:
        database.ready()
        snapshot = OperationsStore(database).snapshot()
        checks[Condition.DATABASE_UNAVAILABLE] = False
        checks[Condition.WORKERS_MISSING] = (
            snapshot.workers.connected_consumers < settings.minimum_workers
        )
        checks[Condition.WORK_OVERDUE] = (
            snapshot.queue.oldest_pending_seconds is not None
            and snapshot.queue.oldest_pending_seconds >= settings.pending_seconds
        )
        checks[Condition.RECOVERY_REQUIRED] = (
            snapshot.queue.awaiting_takeover > 0 or snapshot.queue.interrupted > 0
        )
        checks[Condition.UNCERTAIN_OUTCOMES] = snapshot.usage.uncertain_attempts > 0
    except (psycopg.Error, RuntimeError, ValueError):
        checks[Condition.DATABASE_UNAVAILABLE] = True
        # Other database-backed conditions remain unknown, never falsely healthy.
    checks[Condition.WORKBENCH_UNAVAILABLE] = not http.ready(settings.origin)
    return Observation(observed_at=clock(), checks=checks)
