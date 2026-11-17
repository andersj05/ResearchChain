"""Synthetic monitor state proves outage, retry and secret-handling behavior."""

from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import SecretStr, ValidationError

from researchchain.monitor_engine import (
    acknowledge,
    attempt_due,
    begin_attempt,
    observe,
    prepare_event,
    sample_due,
)
from researchchain.monitor_models import (
    Condition as C,
)
from researchchain.monitor_models import (
    MonitorError,
    MonitorSettings,
    MonitorState,
    Observation,
)
from researchchain.monitor_store import MonitorStore

NOW = datetime(2026, 1, 1, tzinfo=UTC)
CANARY = "private-monitor-secret-canary"


def settings(**values: object) -> MonitorSettings:
    return MonitorSettings.model_validate(
        {"workspace_id": "a" * 64, "origin": "http://127.0.0.1:3000", **values}
    )


def observation(seconds: int, *active: C, unknown: tuple[C, ...] = ()) -> Observation:
    checks: dict[C, bool | None] = {code: code in active for code in C}
    for code in unknown:
        checks[code] = None
    return Observation(observed_at=NOW + timedelta(seconds=seconds), checks=checks)


def test_independent_confirmation_and_recovery() -> None:
    config = settings()
    state = MonitorState(monitor_id=config.id)
    observe(state, config, observation(0, C.WORKERS_MISSING, C.WORK_OVERDUE))
    prepare_event(state, NOW)
    assert state.pending is None
    observe(state, config, observation(60, C.WORKERS_MISSING))
    prepare_event(state, NOW + timedelta(seconds=60))
    assert state.pending is not None and state.pending.active == [C.WORKERS_MISSING]
    assert state.confirmed == {C.WORKERS_MISSING}
    acknowledge(state, NOW + timedelta(seconds=60))
    observe(state, config, observation(120, C.WORK_OVERDUE))
    prepare_event(state, NOW + timedelta(seconds=120))
    assert state.pending is None
    observe(state, config, observation(180))
    prepare_event(state, NOW + timedelta(seconds=180))
    assert state.pending is not None and state.pending.kind == "recovered"
    assert state.pending.active == []


def test_unknown_database_observation_never_announces_worker_recovery() -> None:
    config = settings(confirmations=1)
    state = MonitorState(monitor_id=config.id)
    observe(state, config, observation(0, C.WORKERS_MISSING))
    prepare_event(state, NOW)
    acknowledge(state, NOW)
    observe(
        state,
        config,
        observation(60, C.DATABASE_UNAVAILABLE, unknown=(C.WORKERS_MISSING,)),
    )
    prepare_event(state, NOW + timedelta(seconds=60))
    assert state.pending is not None
    assert set(state.pending.active) == {C.DATABASE_UNAVAILABLE, C.WORKERS_MISSING}
    acknowledge(state, NOW + timedelta(seconds=60))
    observe(state, config, Observation.unavailable(NOW + timedelta(seconds=120)))
    assert {C.DATABASE_UNAVAILABLE, C.WORKERS_MISSING} <= state.confirmed
    observe(state, config, observation(180))
    prepare_event(state, NOW + timedelta(seconds=180))
    assert state.pending is not None and state.pending.kind == "recovered"


def test_unknown_samples_break_confirmation_streaks() -> None:
    config = settings()
    state = MonitorState(monitor_id=config.id)
    observe(state, config, observation(0, C.WORKERS_MISSING))
    observe(state, config, observation(60, unknown=(C.WORKERS_MISSING,)))
    observe(state, config, observation(120, C.WORKERS_MISSING))
    assert not state.confirmed
    observe(state, config, observation(180, C.WORKERS_MISSING))
    assert state.confirmed == {C.WORKERS_MISSING}


def test_rapid_reads_do_not_count_as_distinct_samples() -> None:
    config = settings()
    state = MonitorState(monitor_id=config.id)
    assert observe(state, config, observation(0, C.WORKERS_MISSING))
    assert not observe(state, config, observation(1, C.WORKERS_MISSING))
    assert not observe(state, config, observation(59, C.WORKERS_MISSING))
    assert not state.confirmed
    assert observe(state, config, observation(60, C.WORKERS_MISSING))
    assert state.confirmed == {C.WORKERS_MISSING}
    with pytest.raises(MonitorError, match="clock"):
        sample_due(state, config, NOW)


def test_pending_event_survives_recovery_and_retries_until_acknowledged() -> None:
    config = settings(confirmations=1)
    state = MonitorState(monitor_id=config.id)
    observe(state, config, observation(0, C.WORKERS_MISSING))
    prepare_event(state, NOW)
    assert state.pending is not None
    original = state.pending.model_dump_json()
    begin_attempt(state, config, NOW)
    assert not attempt_due(state, NOW + timedelta(seconds=59))
    state = MonitorState.model_validate_json(state.model_dump_json())
    observe(state, config, observation(60))
    prepare_event(state, NOW + timedelta(seconds=60))
    assert state.pending is not None and state.pending.model_dump_json() == original
    assert attempt_due(state, NOW + timedelta(seconds=60))
    begin_attempt(state, config, NOW + timedelta(seconds=60))
    assert state.next_attempt_at == NOW + timedelta(seconds=180)
    acknowledge(state, NOW + timedelta(seconds=61))
    prepare_event(state, NOW + timedelta(seconds=61))
    assert state.pending is not None and state.pending.kind == "recovered"
    assert state.pending.id != state.last_event.id
    assert state.pending.observed_at == NOW + timedelta(seconds=60)


def test_backoff_is_bounded_and_initial_health_is_silent() -> None:
    config = settings(confirmations=1)
    state = MonitorState(monitor_id=config.id)
    observe(state, config, observation(0))
    prepare_event(state, NOW)
    assert state.pending is None
    observe(state, config, observation(60, C.UNCERTAIN_OUTCOMES))
    prepare_event(state, NOW + timedelta(seconds=60))
    for _ in range(50):
        begin_attempt(state, config, NOW)
    assert state.next_attempt_at == NOW + timedelta(hours=1)
    assert state.delivery_failed


@pytest.mark.parametrize(
    "url",
    [
        "http://example.invalid/hook",
        "https://user:secret@example.invalid/hook",
        "https://example.invalid/hook#fragment",
        "https://example.invalid:0/hook",
        "https://example.invalid/secret\nheader",
        "https://example.invalid:wrong/hook",
    ],
)
def test_unsafe_webhook_configuration_is_rejected(url: str) -> None:
    with pytest.raises(ValidationError):
        settings(webhook=SecretStr(url))


def test_profile_secrets_never_appear_in_default_serialization() -> None:
    config = settings(
        webhook=SecretStr("https://example.invalid/" + CANARY), bearer=SecretStr(CANARY)
    )
    assert CANARY not in repr(config)
    assert CANARY not in config.model_dump_json()
    assert CANARY in config.model_dump_json(context={"monitor_store": True})


def test_profile_roundtrip_and_refusal_to_overwrite(tmp_path: Path) -> None:
    import os

    config = settings(webhook=SecretStr("https://example.invalid/" + CANARY))
    store = MonitorStore(tmp_path / "profile")
    store.create(config)
    original = store.profile_path.read_bytes()
    with store.locked():
        restored, state = store.read()
        assert restored == config and state.monitor_id == config.id
        observe(state, config, observation(0, C.WORKERS_MISSING))
        store.write(state)
    with store.locked():
        _, state = store.read()
        assert state.last_sampled_at == NOW
    with pytest.raises(MonitorError):
        store.create(settings())
    assert store.profile_path.read_bytes() == original
    if os.name == "nt":
        assert CANARY.encode() not in original
    else:
        assert store.profile_path.stat().st_mode & 0o777 == 0o600
        assert store.directory.stat().st_mode & 0o777 == 0o700


def test_failed_protection_preserves_state_and_redacts_errors(tmp_path: Path, monkeypatch) -> None:
    config = settings()
    store = MonitorStore(tmp_path / "profile")
    store.create(config)
    original = store.state_path.read_bytes()

    def fail(data: bytes) -> bytes:
        raise OSError(CANARY)

    monkeypatch.setattr("researchchain.monitor_store.protect", fail)
    with store.locked(), pytest.raises(MonitorError) as error:
        store.write(MonitorState(monitor_id=config.id))
    assert CANARY not in str(error.value)
    assert store.state_path.read_bytes() == original
    assert not list(store.directory.glob(".monitor-*"))


def test_corrupt_and_mismatched_state_is_preserved(tmp_path: Path) -> None:
    store = MonitorStore(tmp_path / "profile")
    store.create(settings())
    store.state_path.write_bytes(CANARY.encode())
    with store.locked(), pytest.raises(MonitorError) as error:
        store.read()
    assert CANARY not in str(error.value)
    assert store.state_path.read_bytes() == CANARY.encode()

    other = MonitorStore(tmp_path / "other")
    other.create(settings())
    with other.locked(), pytest.raises(MonitorError):
        other.write(MonitorState(monitor_id=uuid4()))
