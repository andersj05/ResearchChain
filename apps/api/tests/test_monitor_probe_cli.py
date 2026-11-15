"""Real synthetic workspace probes and the explicit operator-command boundary."""

import getpass
import json
import warnings

import psycopg
import pytest
from run_fixtures import running_worker
from test_dispatch import setup_queue
from test_monitor_state import CANARY, NOW
from test_operations import eventually

from researchchain.access_config import AccessConfig
from researchchain.artifacts import ArtifactStore
from researchchain.backup_inventory import compare_inventory, inventory
from researchchain.database import Database
from researchchain.monitor import main
from researchchain.monitor_http import Delivery, MonitorHTTP
from researchchain.monitor_models import Condition, MonitorSettings
from researchchain.monitor_probe import collect_observation
from researchchain.monitor_store import MonitorStore
from researchchain.operations import OperationsStore
from researchchain.runtime import RunStore


class LocalHTTP(MonitorHTTP):
    def __init__(self):
        super().__init__()
        self.probes = 0
        self.events = []

    def ready(self, origin):
        self.probes += 1
        return True

    def send(self, settings, event):
        self.events.append(event)
        return Delivery(True)


def policy(database, **values):
    binding = AccessConfig.from_env(database)
    return MonitorSettings(workspace_id=binding.workspace_id, origin=binding.origin, **values)


def test_synthetic_research_is_observed_without_effects_or_private_output(
    database, workflow, monkeypatch, capsys
) -> None:
    queue, request = setup_queue(database, workflow)
    receipt = queue.start(request.model_copy(update={"brief": CANARY}))
    ArtifactStore(database).put(CANARY.encode(), CANARY + ".txt")
    with database.connection() as conn, conn.transaction():
        conn.execute(
            "UPDATE run_jobs SET state='interrupted', queued_at=now()-interval '2 minutes' "
            "WHERE command_id=%s",
            (receipt.command_id,),
        )
        conn.execute(
            "INSERT INTO research_attempts "
            "(id,run_id,path,stage,model,status,reason) "
            "VALUES (gen_random_uuid(),%s,%s,'hypothesize',%s,'unknown',%s)",
            (request.id, CANARY, CANARY, CANARY),
        )
        before = inventory(conn, database.schema)

    def no_provider(*args):
        pytest.fail("Operational checks must not read provider credentials or models")

    monkeypatch.setattr("researchchain.providers.credentials.CredentialStore.read", no_provider)
    monkeypatch.setattr("researchchain.providers.chatgpt_plan.ChatGPTPlan.models", no_provider)
    http = LocalHTTP()
    observed = collect_observation(database, policy(database), http, lambda: NOW)
    assert observed.checks[Condition.DATABASE_UNAVAILABLE] is False
    assert observed.checks[Condition.WORKERS_MISSING] is True
    assert observed.checks[Condition.RECOVERY_REQUIRED] is True
    assert observed.checks[Condition.UNCERTAIN_OUTCOMES] is True
    assert main(["check"], database=database, http=http, clock=lambda: NOW) == 1
    output = capsys.readouterr().out
    assert json.loads(output)["checks"]["uncertain_outcomes"] is True
    for private in (
        CANARY,
        str(request.id),
        str(receipt.command_id),
        database.schema,
        database.url,
    ):
        assert private not in output
    assert http.events == []
    with database.connection() as conn, conn.transaction():
        compare_inventory(before, inventory(conn, database.schema))


def test_overdue_queued_work_and_real_worker_presence(database, workflow) -> None:
    queue, request = setup_queue(database, workflow)
    receipt = queue.start(request)
    with database.connection() as conn, conn.transaction():
        conn.execute(
            "UPDATE run_jobs SET queued_at=now()-interval '2 minutes' WHERE command_id=%s",
            (receipt.command_id,),
        )
    http = LocalHTTP()
    observed = collect_observation(database, policy(database, pending_seconds=30), http)
    assert observed.checks[Condition.WORK_OVERDUE] is True
    # Hold the synthetic queue rather than executing it during a monitoring test.
    with database.connection() as conn, conn.transaction():
        conn.execute(
            "UPDATE run_jobs SET state='interrupted' WHERE command_id=%s", (receipt.command_id,)
        )
    with running_worker(RunStore(database)):
        eventually(lambda: OperationsStore(database).snapshot().workers.connected_consumers == 1)
        assert (
            collect_observation(database, policy(database), http).checks[Condition.WORKERS_MISSING]
            is False
        )
    assert (
        collect_observation(database, policy(database), http).checks[Condition.WORKERS_MISSING]
        is True
    )


def test_database_failure_keeps_its_dependent_observations_unknown(monkeypatch) -> None:
    database = Database(schema="test_monitor_failure")

    def unavailable(*args):
        raise psycopg.OperationalError(CANARY)

    monkeypatch.setattr(Database, "ready", unavailable)
    result = collect_observation(database, policy(database), LocalHTTP(), lambda: NOW)
    assert result.checks[Condition.DATABASE_UNAVAILABLE] is True
    for code in (
        Condition.WORKERS_MISSING,
        Condition.WORK_OVERDUE,
        Condition.RECOVERY_REQUIRED,
        Condition.UNCERTAIN_OUTCOMES,
    ):
        assert result.checks[code] is None
    assert CANARY not in result.model_dump_json()


def test_setup_requires_hidden_input_and_rejects_echo_fallback(
    tmp_path, monkeypatch, capsys
) -> None:
    database = Database(schema="test_monitor_setup")
    target = tmp_path / "profile"
    args = ["setup", "--profile", str(target)]
    monkeypatch.setattr("researchchain.monitor.sys.stdin.isatty", lambda: False)
    assert main(args, database=database) == 2
    assert not target.exists()
    assert "hidden input" in capsys.readouterr().err
    monkeypatch.setattr("researchchain.monitor.sys.stdin.isatty", lambda: True)

    def fallback(*args):
        warnings.warn(CANARY, getpass.GetPassWarning, stacklevel=2)
        pytest.fail("An echoed prompt must never be used")

    monkeypatch.setattr("researchchain.monitor.getpass.getpass", fallback)
    assert main(args, database=database) == 2
    assert not target.exists() and CANARY not in capsys.readouterr().err


def test_invalid_hidden_destination_and_bad_arguments_are_redacted(
    tmp_path, monkeypatch, capsys
) -> None:
    monkeypatch.setattr("researchchain.monitor.sys.stdin.isatty", lambda: True)
    values = iter(["http://example.invalid/" + CANARY, CANARY])
    monkeypatch.setattr("researchchain.monitor.getpass.getpass", lambda *args: next(values))
    assert (
        main(
            ["setup", "--profile", str(tmp_path / "profile")],
            database=Database(schema="test_monitor_setup"),
        )
        == 2
    )
    assert CANARY not in capsys.readouterr().err
    assert not (tmp_path / "profile").exists()
    with pytest.raises(SystemExit) as error:
        main(["setup", "--unknown-secret", CANARY])
    assert error.value.code == 2 and CANARY not in capsys.readouterr().err


def test_local_setup_and_saved_status_do_not_contact_database_or_deliver(
    tmp_path, monkeypatch, capsys
) -> None:
    database = Database(schema="test_monitor_local")
    target = tmp_path / "profile"

    def forbidden(*args):
        pytest.fail("Setup and status must not probe the database")

    monkeypatch.setattr(Database, "ready", forbidden)
    http = LocalHTTP()
    assert (
        main(["setup", "--local-only", "--profile", str(target)], database=database, http=http) == 0
    )
    assert json.loads(capsys.readouterr().out)["monitor_started"] is False
    store = MonitorStore(target)
    before = store.state_path.read_bytes()
    assert main(["status", "--profile", str(target)], database=database, http=http) == 0
    assert json.loads(capsys.readouterr().out)["last_sampled_at"] is None
    assert not http.probes and not http.events
    assert store.state_path.read_bytes() == before


def test_explicit_delivery_test_uses_no_database_probe_and_preserves_state(
    tmp_path, monkeypatch, capsys
) -> None:
    from pydantic import SecretStr

    database = Database(schema="test_monitor_test")
    config = policy(database, webhook=SecretStr("https://example.invalid/" + CANARY))
    store = MonitorStore(tmp_path / "profile")
    store.create(config)
    before = store.state_path.read_bytes()

    def forbidden(*args):
        pytest.fail("A delivery test must not probe research")

    monkeypatch.setattr(Database, "ready", forbidden)
    http = LocalHTTP()
    assert main(["test", "--profile", str(store.directory)], database=database, http=http) == 0
    assert len(http.events) == 1 and http.events[0].kind == "test"
    assert http.events[0].active == [] and http.probes == 0
    assert store.state_path.read_bytes() == before
    assert CANARY not in capsys.readouterr().out


def test_watch_stops_and_releases_its_profile_lock(tmp_path, monkeypatch, capsys) -> None:
    database = Database(schema="test_monitor_watch")
    store = MonitorStore(tmp_path / "profile")
    store.create(policy(database, confirmations=1))

    def unavailable(*args):
        raise psycopg.OperationalError(CANARY)

    def stop(seconds):
        assert seconds == 60
        raise KeyboardInterrupt

    monkeypatch.setattr(Database, "ready", unavailable)
    monkeypatch.setattr("researchchain.monitor.time.sleep", stop)
    assert (
        main(
            ["watch", "--profile", str(store.directory)],
            database=database,
            http=LocalHTTP(),
            clock=lambda: NOW,
        )
        == 130
    )
    assert CANARY not in capsys.readouterr().out
    with store.locked():
        _, state = store.read()
        assert state.confirmed == {Condition.DATABASE_UNAVAILABLE}
