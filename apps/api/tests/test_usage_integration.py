import json
import sys
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from types import SimpleNamespace
from uuid import uuid4

import pytest
from access_fixtures import owner_client
from fastapi.testclient import TestClient
from test_research_runtime import approve, setup_run
from test_retention import apply, preview
from test_usage_store import configure

from researchchain import provider as provider_cli
from researchchain import usage as usage_cli
from researchchain.database import Database
from researchchain.main import create_app
from researchchain.providers.chatgpt_plan import Completion, ModelChoice
from researchchain.retention import RetentionStore
from researchchain.usage_store import UsageStore


def test_separate_runs_share_the_allowance_and_denial_never_calls_provider(database):
    configure(database, 1)
    runs, first, provider = setup_run(database)
    result = runs.start(first)
    assert result.status == "paused"
    assert result.model_attempts[0].admission_policy_revision == 2
    second = first.model_copy(update={"id": uuid4()})
    denied = runs.start(second)
    assert denied.status == "limited" and "Workspace request allowance" in denied.stop_reason
    assert denied.model_attempts[0].admission_policy_revision is None
    assert len(provider.calls) == 1
    assert runs.start(first) == result
    assert UsageStore(database).snapshot().admitted_requests_24h == 1


def test_pause_during_one_request_blocks_the_next_stage_without_cancelling_it(database):
    runs, request, provider = setup_run(database)
    provider.block = True
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(runs.start, request)
        assert provider.started.wait(10)
        configure(database, 100, paused=True)
        provider.released.set()
        first = pending.result(timeout=15)
    assert first.status == "paused" and not provider.cancelled.is_set()
    denied = runs.resume(request.id, approve(first))
    assert denied.status == "limited" and "paused for this workspace" in denied.stop_reason
    assert len(provider.calls) == 1
    assert UsageStore(database).snapshot().admitted_requests_24h == 1


def test_request_preparation_failure_does_not_consume_an_admission(database):
    runs, request, provider = setup_run(database, max_input_bytes=1000)
    assert runs.start(request).status in {"limited", "failed"}
    assert not provider.calls
    assert UsageStore(database).snapshot().admitted_requests_24h == 0


def test_worker_failure_does_not_refund_an_admission(database):
    configure(database, 1)
    runs, request, provider = setup_run(database)
    provider.crash = True
    with pytest.raises(RuntimeError, match="Simulated worker interruption"):
        runs.start(request)
    assert UsageStore(database).snapshot().admitted_requests_24h == 1
    provider.crash = False
    denied = runs.start(request.model_copy(update={"id": uuid4()}))
    assert denied.status == "limited"
    assert len(provider.calls) == 1


def test_real_run_cleanup_does_not_reset_the_request_count(database):
    configure(database, 3)
    runs, request, provider = setup_run(database)
    first = runs.start(request)
    revised = runs.resume(request.id, approve(first))
    assert runs.resume(request.id, approve(revised)).status == "completed"
    retention = RetentionStore(database)
    record = preview(retention)
    assert [item.run_id for item in record.runs] == [request.id]
    apply(retention, record)
    with database.connection() as conn:
        assert (
            conn.execute("SELECT count(*) AS count FROM research_attempts").fetchone()["count"] == 0
        )
    assert UsageStore(database).snapshot().admitted_requests_24h == 3
    denied = runs.start(request.model_copy(update={"id": uuid4()}))
    assert denied.status == "limited" and len(provider.calls) == 3


def test_owner_policy_api_validates_access_csrf_and_stale_edits(database):
    app = create_app(database)
    with TestClient(
        app,
        base_url=app.state.access.config.origin,
        headers={"Origin": app.state.access.config.origin},
    ) as anonymous:
        assert anonymous.get("/api/usage").status_code == 401
        assert anonymous.post("/api/usage/policy", json={}).status_code == 401
    with owner_client(app) as client:
        response = client.get("/api/usage")
        assert response.status_code == 200 and "no-store" in response.headers["cache-control"]
        update = {"expected_revision": 1, "max_requests_24h": 4, "paused": True}
        assert (
            client.post(
                "/api/usage/policy", json=update, headers={"X-ResearchChain-CSRF": "invalid"}
            ).status_code
            == 403
        )
        changed = client.post("/api/usage/policy", json=update)
        assert changed.status_code == 200
        assert changed.json()["policy"]["changed_by"] == "owner"
        assert client.post("/api/usage/policy", json=update).status_code == 409
        for invalid in [
            {"expected_revision": 2, "max_requests_24h": 0, "paused": False},
            {"expected_revision": 2, "max_requests_24h": 10001, "paused": False},
            {"expected_revision": 2, "max_requests_24h": True, "paused": False},
            {"expected_revision": 2, "max_requests_24h": 4, "paused": "false"},
        ]:
            assert client.post("/api/usage/policy", json=invalid).status_code == 422
    assert UsageStore(database).snapshot().policy.paused is True


def test_operator_cli_uses_compare_and_set_and_reads_do_not_admit(database, monkeypatch, capsys):
    monkeypatch.setattr(Database, "from_env", classmethod(lambda cls: database))
    monkeypatch.setattr(sys, "argv", ["usage", "status"])
    assert usage_cli.main() == 0
    assert json.loads(capsys.readouterr().out)["admitted_requests_24h"] == 0
    monkeypatch.setattr(
        sys,
        "argv",
        ["usage", "configure", "--expected-revision", "1", "--max-requests", "9", "--pause"],
    )
    assert usage_cli.main() == 0
    assert json.loads(capsys.readouterr().out)["policy"]["paused"] is True
    assert usage_cli.main() == 2
    assert "changed" in capsys.readouterr().err
    assert UsageStore(database).snapshot().admitted_requests_24h == 0


def test_connection_verification_has_the_same_no_send_boundary(database, monkeypatch, capsys):
    configure(database, 1)
    calls = []
    fake_store = SimpleNamespace(
        locked=lambda: nullcontext(),
        read=lambda: SimpleNamespace(active_client_id="synthetic", accounts={}),
    )

    class FakePlan:
        def models(self):
            return "synthetic", [ModelChoice("test-model", "Synthetic model")]

        async def complete(self, *args, **kwargs):
            assert UsageStore(database).snapshot().admitted_requests_24h == 1
            calls.append(True)
            return Completion("test-model", "ResearchChain connected.", "synthetic", {})

    monkeypatch.setattr(Database, "from_env", classmethod(lambda cls: database))
    monkeypatch.setattr(provider_cli, "CredentialStore", lambda: fake_store)
    monkeypatch.setattr(provider_cli, "ChatGPTAuth", lambda *args: None)
    monkeypatch.setattr(provider_cli, "ChatGPTPlan", lambda *args: FakePlan())
    monkeypatch.setattr(sys, "argv", ["provider", "verify", "--model", "test-model"])
    assert provider_cli.main() == 0 and len(calls) == 1
    assert provider_cli.main() == 1 and len(calls) == 1
    output = capsys.readouterr()
    assert "Workspace request allowance reached" in output.err
    with database.connection() as conn:
        row = conn.execute("SELECT source FROM model_request_admissions").fetchone()
    assert row["source"] == "connection_test"
