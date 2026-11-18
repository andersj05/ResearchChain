"""HTTP accepts durable commands without executing or waiting on a provider."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event
from typing import Any
from uuid import uuid4

import pytest
from access_fixtures import owner_client
from run_fixtures import run_request
from test_research_runtime import setup_run

from researchchain.database import Database
from researchchain.dispatch import RunQueue
from researchchain.dispatch_models import QueueLimits
from researchchain.main import create_app
from researchchain.research import ResearchExecutor
from researchchain.worker import RunWorker


def test_http_returns_stable_receipt_before_worker_execution(
    database: Database, workflow: dict
) -> None:
    app = create_app(database)
    with owner_client(app, workers=False) as client:
        revision = client.post("/api/revisions", json=workflow).json()
        body = {"id": str(uuid4()), "revision_id": revision["id"], "brief": "Queued API test"}
        first = client.post("/api/runs", json=body)
        assert first.status_code == 202
        assert first.json()["run_id"] == body["id"] and first.json()["kind"] == "start"
        assert set(first.json()) == {"command_id", "run_id", "kind", "accepted_at"}
        path = f"/api/runs/{body['id']}"
        inbox = "/api/runs/reviews"
        assert client.get(path).json()["status"] == "queued"
        assert client.get(inbox).json() == {"items": [], "has_more": False}
        assert client.post("/api/runs", json=body).json() == first.json()
        assert RunWorker(app.state.runs).run_once()
        paused = client.get(path).json()
        assert paused["status"] == "paused"
        assert client.get(inbox).json() == {
            "items": [
                {
                    key: paused[key]
                    for key in (
                        "id",
                        "agent_name",
                        "workflow_name",
                        "created_at",
                        "checkpoint_id",
                        "reviews",
                    )
                }
            ],
            "has_more": False,
        }
        assert client.post("/api/runs", json=body).json() == first.json()
        resume = client.post(
            f"{path}/resume",
            json={
                "checkpoint_id": paused["checkpoint_id"],
                "interrupt_id": paused["review"]["interrupt_id"],
                "decision": "approve",
            },
        )
        assert resume.status_code == 202 and resume.json()["kind"] == "resume"
        assert client.get(path).json()["status"] == "queued"
        assert client.get(inbox).json() == {"items": [], "has_more": False}
        assert RunWorker(app.state.runs).run_once()
        assert client.get(path).json()["status"] == "completed"
        assert client.get(inbox).json() == {"items": [], "has_more": False}
        assert client.post(f"{path}/recover").json() == resume.json()


def test_http_retry_does_not_wait_for_live_provider(database: Database) -> None:
    runs, request, provider = setup_run(database)
    app = create_app(database, provider=provider)
    provider.block = True
    with owner_client(app, workers=False) as client, ThreadPoolExecutor(max_workers=2) as executor:
        first = client.post("/api/runs", json=request.model_dump(mode="json"))
        assert first.status_code == 202
        work = executor.submit(RunWorker(app.state.runs).run_once)
        try:
            assert provider.started.wait(5)
            repeat = executor.submit(client.post, "/api/runs", json=request.model_dump(mode="json"))
            assert repeat.result(timeout=3).json() == first.json()
            assert not work.done()
        finally:
            provider.released.set()
        assert work.result(timeout=5)
        assert len(provider.calls) == 1


def test_http_queue_limit_and_queued_cancellation(database: Database, workflow: dict) -> None:
    app = create_app(database)
    RunQueue(app.state.runs).configure(QueueLimits(max_pending=1))
    with owner_client(app, workers=False) as client:
        revision = client.post("/api/revisions", json=workflow).json()
        body = {"id": str(uuid4()), "revision_id": revision["id"], "brief": "Bounded admission"}
        assert client.post("/api/runs", json=body).status_code == 202
        next_body = {**body, "id": str(uuid4())}
        full = client.post("/api/runs", json=next_body)
        assert full.status_code == 429 and full.headers["retry-after"] == "1"
        assert client.get(f"/api/runs/{next_body['id']}").status_code == 404
        assert client.post(f"/api/runs/{body['id']}/cancel").json()["status"] == "cancelled"
        assert client.get(f"/api/runs/{body['id']}").json()["execution_pending"]
        assert client.post("/api/runs", json=next_body).status_code == 202
        assert RunWorker(app.state.runs).run_once()
        cancelled = client.get(f"/api/runs/{body['id']}").json()
        assert cancelled["status"] == "cancelled" and not cancelled["execution_pending"]
        assert not cancelled["events"]


def test_worker_fixture_follows_real_admission(database: Database, workflow: dict) -> None:
    with owner_client(create_app(database)) as client:
        revision = client.post("/api/revisions", json=workflow).json()
        result = run_request(
            client,
            "/api/runs",
            json={"id": str(uuid4()), "revision_id": revision["id"], "brief": "Follow receipt"},
        )
        assert result.status_code == 200 and result.json()["status"] == "paused"


def test_cancelled_run_stays_active_until_worker_saves_final_response(
    database: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, request, provider = setup_run(database)
    provider.block = True
    app = create_app(database, provider=provider)
    finishing, release = Event(), Event()
    original = ResearchExecutor.finish

    def delayed_finish(*args: Any, **kwargs: Any) -> None:
        finishing.set()
        assert release.wait(10)
        original(*args, **kwargs)

    monkeypatch.setattr(ResearchExecutor, "finish", delayed_finish)
    with owner_client(app, workers=False) as client, ThreadPoolExecutor(max_workers=1) as executor:
        accepted = client.post("/api/runs", json=request.model_dump(mode="json"))
        assert accepted.status_code == 202
        work = executor.submit(RunWorker(app.state.runs).run_once)
        path = f"/api/runs/{request.id}"
        try:
            assert provider.started.wait(5)
            assert client.post(f"{path}/cancel").json()["status"] == "cancelled"
            assert finishing.wait(5)
            pending = client.get(path).json()
            assert pending["status"] == "cancelled" and pending["execution_pending"]
            assert pending["model_attempts"][0]["response_artifact_id"] is None
        finally:
            release.set()
            provider.released.set()
        assert work.result(timeout=5)
        final = client.get(path).json()
        assert final["status"] == "cancelled" and not final["execution_pending"]
        assert final["model_attempts"][0]["status"] == "cancelled"
        assert final["model_attempts"][0]["response_artifact_id"]
