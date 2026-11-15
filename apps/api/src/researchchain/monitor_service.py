"""One explicit monitor cycle; saves before send and serializes all operators."""

from collections.abc import Callable
from datetime import datetime, timedelta

from researchchain.access_config import AccessConfig
from researchchain.database import Database
from researchchain.monitor_engine import (
    acknowledge,
    attempt_due,
    begin_attempt,
    observe,
    prepare_event,
    sample_due,
)
from researchchain.monitor_http import Delivery, MonitorHTTP
from researchchain.monitor_models import (
    AlertEvent,
    MonitorError,
    MonitorSettings,
    MonitorState,
    Observation,
)
from researchchain.monitor_probe import collect_observation, utcnow
from researchchain.monitor_store import MonitorStore

Probe = Callable[[Database, MonitorSettings, MonitorHTTP, Callable[[], datetime]], Observation]


def report(settings: MonitorSettings, state: MonitorState) -> dict[str, object]:
    return {
        "monitor_id": str(settings.id),
        "external_delivery_configured": settings.webhook is not None,
        "interval_seconds": settings.interval_seconds,
        "last_sampled_at": state.last_sampled_at.isoformat() if state.last_sampled_at else None,
        "active": sorted(state.confirmed),
        "pending_confirmation": sorted(
            code
            for code, streak in state.streaks.items()
            if streak.value is True and code not in state.confirmed
        ),
        "pending_event": str(state.pending.id) if state.pending else None,
        "last_event": state.last_event.model_dump(mode="json") if state.last_event else None,
        "delivery_failed": state.delivery_failed,
        "next_attempt_at": state.next_attempt_at.isoformat() if state.next_attempt_at else None,
        "last_acknowledged_at": (
            state.last_acknowledged_at.isoformat() if state.last_acknowledged_at else None
        ),
    }


class Monitor:
    def __init__(
        self,
        database: Database,
        store: MonitorStore,
        *,
        http: MonitorHTTP | None = None,
        clock: Callable[[], datetime] = utcnow,
        probe: Probe = collect_observation,
    ):
        self.database = database
        self.store = store
        self.binding = AccessConfig.from_env(database)
        self.http = http or MonitorHTTP()
        self.clock = clock
        self.probe = probe

    def _read(self) -> tuple[MonitorSettings, MonitorState]:
        settings, state = self.store.read()
        if (
            settings.workspace_id != self.binding.workspace_id
            or settings.origin != self.binding.origin
        ):
            raise MonitorError("This monitor profile belongs to a different workspace or origin.")
        return settings, state

    def status(self) -> dict[str, object]:
        with self.store.locked():
            settings, state = self._read()
            return report(settings, state)

    def once(self) -> dict[str, object]:
        with self.store.locked():
            settings, state = self._read()
            sampled = False
            if sample_due(state, settings, self.clock()):
                try:
                    observation = self.probe(self.database, settings, self.http, self.clock)
                except Exception:
                    observation = Observation.unavailable(self.clock())
                sampled = observe(state, settings, observation)
            prepare_event(state, self.clock())
            self.store.write(state)
            delivery = "not_due"
            if attempt_due(state, self.clock()):
                assert state.pending is not None
                if settings.webhook is None:
                    # Local-only publication is the durable last_event in this profile.
                    acknowledge(state, self.clock())
                    self.store.write(state)
                    delivery = "recorded_locally"
                else:
                    begin_attempt(state, settings, self.clock())
                    self.store.write(state)  # Event and retry time precede any network send.
                    result = self.http.send(settings, state.pending)
                    if result.accepted:
                        acknowledge(state, self.clock())
                        delivery = "acknowledged"
                    else:
                        delivery = "failed"
                        if result.retry_seconds is not None:
                            assert state.next_attempt_at is not None
                            state.next_attempt_at = max(
                                state.next_attempt_at,
                                self.clock() + timedelta(seconds=result.retry_seconds),
                            )
                    self.store.write(state)
            return {**report(settings, state), "sampled": sampled, "delivery": delivery}

    def test_delivery(self) -> Delivery:
        with self.store.locked():
            settings, _ = self._read()
            if settings.webhook is None:
                raise MonitorError("This profile has no external delivery destination.")
            now = self.clock()
            event = AlertEvent(
                monitor_id=settings.id,
                created_at=now,
                observed_at=now,
                kind="test",
                active=[],
            )
            # Explicit test notifications never acknowledge or change real incident state.
            return self.http.send(settings, event)
