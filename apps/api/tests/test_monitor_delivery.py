"""Persisted monitor cycles use synthetic profiles and injected observations."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from threading import Event

import pytest
from pydantic import SecretStr
from test_monitor_state import CANARY, NOW, observation

from researchchain.access_config import AccessConfig
from researchchain.database import Database
from researchchain.monitor_http import Delivery, MonitorHTTP
from researchchain.monitor_models import AlertEvent, Condition, MonitorError, MonitorSettings
from researchchain.monitor_service import Monitor
from researchchain.monitor_store import MonitorStore


class Clock:
    def __init__(self):
        self.now = NOW

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += timedelta(seconds=seconds)


class Receiver(MonitorHTTP):
    def __init__(self, store, reply=None):
        super().__init__()
        self.store = store
        self.reply = reply
        self.events = []

    def send(self, settings: MonitorSettings, event: AlertEvent) -> Delivery:
        _, stored = self.store.read()
        assert stored.pending is not None
        assert stored.pending.model_dump_json() == event.model_dump_json()
        assert stored.attempts > 0 and stored.next_attempt_at is not None
        self.events.append(event.model_dump_json())
        return self.reply(event) if self.reply else Delivery(True)


def profile(tmp_path: Path, *, external=True):
    database = Database(schema="test_monitor_synthetic")
    binding = AccessConfig.from_env(database)
    settings = MonitorSettings(
        workspace_id=binding.workspace_id,
        origin=binding.origin,
        confirmations=1,
        webhook=SecretStr("https://example.invalid/" + CANARY) if external else None,
    )
    store = MonitorStore(tmp_path / "profile")
    store.create(settings)
    return database, store, Clock()


def missing(database, settings, http, clock):
    result = observation(0, Condition.WORKERS_MISSING)
    return result.model_copy(update={"observed_at": clock()})


def healthy(database, settings, http, clock):
    return observation(0).model_copy(update={"observed_at": clock()})


def test_delivery_is_persisted_first_and_normal_reads_do_not_resend(tmp_path: Path) -> None:
    database, store, clock = profile(tmp_path)
    receiver = Receiver(store)
    monitor = Monitor(database, store, http=receiver, clock=clock, probe=missing)
    result = monitor.once()
    assert result["delivery"] == "acknowledged" and len(receiver.events) == 1
    state_before = store.state_path.read_bytes()
    assert monitor.status()["active"] == [Condition.WORKERS_MISSING]
    assert store.state_path.read_bytes() == state_before
    assert monitor.once()["sampled"] is False
    assert len(receiver.events) == 1
    clock.advance(60)
    assert monitor.once()["sampled"] is True
    assert len(receiver.events) == 1
    assert CANARY not in str(result)


def test_crash_after_send_retries_original_event_then_reports_recovery(
    tmp_path: Path, monkeypatch
) -> None:
    database, store, clock = profile(tmp_path)
    receiver = Receiver(store)
    original_write = store.write

    def crash_after_ack(state):
        if state.pending is None and state.last_event is not None:
            raise MonitorError("Synthetic acknowledgement persistence failure.")
        original_write(state)

    monkeypatch.setattr(store, "write", crash_after_ack)
    monitor = Monitor(database, store, http=receiver, clock=clock, probe=missing)
    with pytest.raises(MonitorError):
        monitor.once()
    assert len(receiver.events) == 1
    _, persisted = store.read()
    assert persisted.pending is not None
    original_event = persisted.pending.model_dump_json()
    monkeypatch.setattr(store, "write", original_write)
    clock.advance(60)
    restarted = Monitor(database, store, http=receiver, clock=clock, probe=healthy)
    assert restarted.once()["delivery"] == "acknowledged"
    assert receiver.events == [original_event, original_event]
    # A recovery confirmed while the previous event was pending follows its ack.
    clock.advance(1)
    result = restarted.once()
    assert result["sampled"] is False and result["delivery"] == "acknowledged"
    recovery = AlertEvent.model_validate_json(receiver.events[-1])
    assert recovery.kind == "recovered" and recovery.id != persisted.pending.id


def test_interruption_during_send_preserves_event_and_prevents_an_immediate_retry(
    tmp_path: Path,
) -> None:
    database, store, clock = profile(tmp_path)

    def stop(event):
        raise KeyboardInterrupt

    receiver = Receiver(store, stop)
    monitor = Monitor(database, store, http=receiver, clock=clock, probe=missing)
    with pytest.raises(KeyboardInterrupt):
        monitor.once()
    _, state = store.read()
    assert state.pending is not None and state.attempts == 1
    receiver.reply = None
    assert monitor.once()["delivery"] == "not_due"
    assert len(receiver.events) == 1
    clock.advance(60)
    assert monitor.once()["delivery"] == "acknowledged"
    assert receiver.events[0] == receiver.events[1]


def test_retry_after_is_respected_without_blocking_new_observations(tmp_path: Path) -> None:
    database, store, clock = profile(tmp_path)
    receiver = Receiver(store, lambda event: Delivery(False, 600))
    monitor = Monitor(database, store, http=receiver, clock=clock, probe=missing)
    assert monitor.once()["delivery_failed"] is True
    clock.advance(60)
    assert monitor.once()["sampled"] is True
    assert len(receiver.events) == 1
    clock.advance(539)
    assert monitor.once()["delivery"] == "not_due"
    receiver.reply = None
    clock.advance(1)
    assert monitor.once()["delivery"] == "acknowledged"
    assert len(receiver.events) == 2 and receiver.events[0] == receiver.events[1]


def test_local_only_records_latest_event_and_never_delivers(tmp_path: Path) -> None:
    database, store, clock = profile(tmp_path, external=False)
    receiver = Receiver(store, lambda event: pytest.fail("No external delivery is allowed"))
    monitor = Monitor(database, store, http=receiver, clock=clock, probe=missing)
    result = monitor.once()
    assert result["delivery"] == "recorded_locally" and not receiver.events
    assert result["last_event"]["kind"] == "problem"
    clock.advance(60)
    restarted = Monitor(database, store, http=receiver, clock=clock, probe=healthy)
    assert restarted.once()["last_event"]["kind"] == "recovered"
    assert restarted.status()["active"] == []


def test_profile_binding_fails_before_any_probe_or_delivery(tmp_path: Path) -> None:
    _, store, clock = profile(tmp_path)
    before = store.state_path.read_bytes()
    database = Database(schema="test_other_monitor")
    receiver = Receiver(store)
    monitor = Monitor(
        database,
        store,
        http=receiver,
        clock=clock,
        probe=lambda *args: pytest.fail("Wrong workspace must not be sampled"),
    )
    with pytest.raises(MonitorError, match="different workspace"):
        monitor.once()
    assert store.state_path.read_bytes() == before and not receiver.events


def test_concurrent_cycles_share_confirmation_and_outbox(tmp_path: Path) -> None:
    database, store, clock = profile(tmp_path)
    receiver = Receiver(store)
    entered, release = Event(), Event()
    calls = []

    def slow(*args):
        calls.append(True)
        entered.set()
        assert release.wait(5)
        return missing(*args)

    first = Monitor(database, store, http=receiver, clock=clock, probe=slow)
    second = Monitor(database, store, http=receiver, clock=clock, probe=missing)
    with ThreadPoolExecutor(max_workers=2) as pool:
        one = pool.submit(first.once)
        assert entered.wait(5)
        two = pool.submit(second.once)
        release.set()
        results = [one.result(timeout=10), two.result(timeout=10)]
    assert sorted(item["sampled"] for item in results) == [False, True]
    assert len(calls) == len(receiver.events) == 1


def test_unexpected_probe_failure_is_recorded_without_clearing_existing_incident(
    tmp_path: Path,
) -> None:
    database, store, clock = profile(tmp_path, external=False)
    monitor = Monitor(database, store, clock=clock, probe=missing)
    monitor.once()
    clock.advance(60)

    def fail(*args):
        raise RuntimeError(CANARY)

    restarted = Monitor(database, store, clock=clock, probe=fail)
    result = restarted.once()
    assert set(result["active"]) == {
        Condition.WORKERS_MISSING,
        Condition.OBSERVATION_UNAVAILABLE,
    }
    assert CANARY not in str(result)


def test_explicit_test_does_not_acknowledge_pending_incidents(tmp_path: Path) -> None:
    database, store, clock = profile(tmp_path)
    failed = Receiver(store, lambda event: Delivery(False))
    Monitor(database, store, http=failed, clock=clock, probe=missing).once()
    before = store.state_path.read_bytes()

    class TestReceiver(MonitorHTTP):
        def send(self, settings, event):
            assert event.kind == "test" and event.active == []
            return Delivery(True)

    assert Monitor(database, store, http=TestReceiver(), clock=clock).test_delivery().accepted
    assert store.state_path.read_bytes() == before


def hold_profile_lock(directory, ready, release):
    with MonitorStore(Path(directory)).locked():
        ready.set()
        assert release.wait(15)


def test_another_process_cannot_advance_a_locked_profile(tmp_path: Path) -> None:
    import multiprocessing

    database, store, clock = profile(tmp_path)
    context = multiprocessing.get_context("spawn")
    ready, release = context.Event(), context.Event()
    process = context.Process(
        target=hold_profile_lock, args=(str(store.directory), ready, release), daemon=True
    )
    receiver = Receiver(store)
    process.start()
    try:
        assert ready.wait(10)
        with pytest.raises(MonitorError, match="busy"):
            Monitor(database, store, http=receiver, clock=clock, probe=missing).once()
        assert not receiver.events
        assert store.read()[1].last_sampled_at is None
    finally:
        release.set()
        process.join(timeout=10)
        if process.is_alive():
            process.terminate()
            process.join(timeout=5)
        assert process.exitcode == 0
