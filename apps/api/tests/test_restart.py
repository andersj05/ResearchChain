"""Exercise a hard API-process restart against real Postgres, not a new Python object."""

import os
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from uuid import uuid4

import httpx

from researchchain.database import Database


@contextmanager
def api_process(database: Database) -> Iterator[httpx.Client]:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    environment = {
        **os.environ,
        "DATABASE_URL": database.url,
        "DATABASE_SCHEMA": database.schema,
    }
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "researchchain.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--no-access-log",
        ],
        env=environment,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    try:
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=5) as client:
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise AssertionError("Test API exited before becoming ready.")
                try:
                    if client.get("/api/health").status_code == 200:
                        break
                except httpx.TransportError:
                    pass
                time.sleep(0.05)
            else:
                raise AssertionError("Test API did not become ready within 20 seconds.")
            yield client
    finally:
        if process.poll() is None:
            process.kill()  # Deliberately skip graceful shutdown and all Python cleanup.
        process.wait(timeout=10)
        if process.stderr:
            process.stderr.close()


def test_paused_run_survives_hard_process_restart(database: Database, workflow: dict) -> None:
    with api_process(database) as first:
        revision = first.post("/api/revisions", json=workflow).json()
        paused = first.post(
            "/api/runs",
            json={
                "id": str(uuid4()),
                "revision_id": revision["id"],
                "brief": "Across a hard restart",
            },
        ).json()
        assert paused["status"] == "paused"
        workflow["nodes"][0]["instructions"] = "A newer revision must not alter the paused run."
        newer = first.post("/api/revisions", json=workflow).json()
        assert newer["id"] != revision["id"]

    with api_process(database) as second:
        restored = second.get(f"/api/runs/{paused['id']}")
        assert restored.status_code == 200
        assert restored.json() == paused
        assert second.get("/api/runs").json()[0]["id"] == paused["id"]
        response = second.post(
            f"/api/runs/{paused['id']}/resume",
            json={
                "checkpoint_id": paused["checkpoint_id"],
                "interrupt_id": paused["review"]["interrupt_id"],
                "decision": "approve",
            },
        )
        assert response.status_code == 200
        completed = response.json()
        assert completed["status"] == "completed"
        assert completed["workflow"] == revision["workflow"]
        assert [event["node_id"] for event in completed["events"]] == [
            "frame",
            "challenge",
            "review",
            "finish",
        ]

    with api_process(database) as third:
        assert third.get(f"/api/runs/{paused['id']}").json() == completed


def test_conflicting_decisions_across_two_api_processes(database: Database, workflow: dict) -> None:
    workflow["nodes"][1]["kind"] = "review"
    with api_process(database) as first, api_process(database) as second:
        revision = first.post("/api/revisions", json=workflow).json()
        paused = first.post(
            "/api/runs",
            json={
                "id": str(uuid4()),
                "revision_id": revision["id"],
                "brief": "Two independent workers",
            },
        ).json()
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [
                executor.submit(
                    client.post,
                    f"/api/runs/{paused['id']}/resume",
                    json={
                        "checkpoint_id": paused["checkpoint_id"],
                        "interrupt_id": paused["review"]["interrupt_id"],
                        "decision": decision,
                    },
                )
                for client, decision in ((first, "approve"), (second, "reject"))
            ]
            results = [future.result() for future in futures]
        assert sorted(response.status_code for response in results) == [200, 409]
        winner = next(response.json() for response in results if response.status_code == 200)
        assert first.get(f"/api/runs/{paused['id']}").json() == winner
        assert second.get(f"/api/runs/{paused['id']}").json() == winner
        assert [event["node_id"] for event in winner["events"]] == ["frame", "challenge"]
