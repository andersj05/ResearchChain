"""Independent condition confirmation and a durable, acknowledgement-based outbox."""

from datetime import datetime, timedelta

from researchchain.monitor_models import (
    AlertEvent,
    MonitorError,
    MonitorSettings,
    MonitorState,
    Observation,
    Streak,
)


def sample_due(state: MonitorState, settings: MonitorSettings, now: datetime) -> bool:
    if state.last_sampled_at is None:
        return True
    elapsed = (now - state.last_sampled_at).total_seconds()
    if elapsed < 0:
        raise MonitorError("The system clock moved backward. Correct it before monitoring.")
    return elapsed >= settings.interval_seconds


def observe(state: MonitorState, settings: MonitorSettings, observation: Observation) -> bool:
    if state.monitor_id != settings.id:
        raise MonitorError("The monitor profile and state do not match.")
    if not sample_due(state, settings, observation.observed_at):
        return False
    for code, value in observation.checks.items():
        streak = state.streaks[code]
        if value is None:
            state.streaks[code] = Streak()
            continue  # Unknown never clears a previously confirmed incident.
        if streak.value != value:
            streak = Streak(value=value)
        streak.count = min(settings.confirmations, streak.count + 1)
        state.streaks[code] = streak
        if streak.count >= settings.confirmations:
            if value:
                state.confirmed.add(code)
            else:
                state.confirmed.discard(code)
    state.last_sampled_at = observation.observed_at
    return True


def prepare_event(state: MonitorState, now: datetime) -> None:
    if state.pending is not None or state.confirmed == state.acknowledged:
        return
    assert state.last_sampled_at is not None
    state.pending = AlertEvent(
        monitor_id=state.monitor_id,
        created_at=now,
        observed_at=state.last_sampled_at,
        kind="problem" if state.confirmed else "recovered",
        active=sorted(state.confirmed),
    )
    state.attempts = 0
    state.next_attempt_at = now
    state.delivery_failed = False


def attempt_due(state: MonitorState, now: datetime) -> bool:
    return state.pending is not None and (
        state.next_attempt_at is None or now >= state.next_attempt_at
    )


def begin_attempt(state: MonitorState, settings: MonitorSettings, now: datetime) -> None:
    assert state.pending is not None
    state.attempts = min(1000, state.attempts + 1)
    seconds = min(3600, settings.interval_seconds * 2 ** min(8, state.attempts - 1))
    state.next_attempt_at = now + timedelta(seconds=seconds)
    # Save this before network I/O, including a backoff for a crash during delivery.
    state.delivery_failed = True


def acknowledge(state: MonitorState, now: datetime) -> None:
    assert state.pending is not None
    state.acknowledged = set(state.pending.active)
    state.last_event = state.pending
    state.pending = None
    state.attempts = 0
    state.next_attempt_at = None
    state.delivery_failed = False
    state.last_acknowledged_at = now
