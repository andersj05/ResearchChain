"""Tests sign in through the real HTTP exchange with private synthetic stores."""

from collections.abc import Iterator
from contextlib import contextmanager, nullcontext

from fastapi import FastAPI
from fastapi.testclient import TestClient
from run_fixtures import running_worker

from researchchain.access_api import CSRF_HEADER
from researchchain.access_service import AccessService


@contextmanager
def owner_client(app: FastAPI, *, workers: bool = True) -> Iterator[TestClient]:
    access: AccessService = app.state.access
    code = access.issue_link("Synthetic owner")
    with TestClient(app, base_url=access.config.origin) as client:
        client.headers["Origin"] = access.config.origin
        result = client.post("/api/access/exchange", json={"code": code.get_secret_value()})
        assert result.status_code == 200
        client.headers[CSRF_HEADER] = result.json()["session"]["csrf_token"]
        with running_worker(app.state.runs) if workers else nullcontext():
            yield client
