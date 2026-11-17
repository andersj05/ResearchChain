"""Owner sessions guard real research routes, before parsing input or reading records."""

import re
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import replace
from typing import Any
from uuid import uuid4

import pytest
from access_fixtures import owner_client
from fastapi import FastAPI
from fastapi.testclient import TestClient
from psycopg import sql
from starlette.routing import Route
from test_access_service import PASSWORD
from test_evaluation_datasets import case_for, dataset
from test_reports import seeded

from researchchain.access_api import CSRF_HEADER, PUBLIC
from researchchain.access_config import AccessConfig
from researchchain.access_service import AccessService
from researchchain.database import Database
from researchchain.main import create_app


@contextmanager
def second_workspace(database: Database) -> Iterator[Database]:
    other = replace(database, schema="test_" + uuid4().hex)
    try:
        other.migrate()
        yield other
    finally:
        assert other.schema.startswith("test_") and len(other.schema) == 37
        with other.connection() as conn:
            conn.execute(
                sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(other.schema))
            )


def anonymous(app: FastAPI) -> TestClient:
    return TestClient(app, base_url=app.state.access.config.origin)


def test_anonymous_denied_on_every_registered_resource_before_validation(
    database: Database,
) -> None:
    app = create_app(database)

    @app.get("/api/future-resource")
    def future_resource() -> dict[str, str]:
        raise AssertionError("An unregistered resource must also require owner access.")

    assert PUBLIC == {
        ("GET", "/api/health"),
        ("GET", "/api/access/status"),
        ("POST", "/api/access/login"),
        ("POST", "/api/access/exchange"),
    }
    protected = 0
    with anonymous(app) as client:
        client.headers["Origin"] = app.state.access.config.origin
        assert client.get("/api/health").json() == {"status": "ok"}
        status = client.get("/api/access/status").json()
        assert status == {"authenticated": False, "password_enabled": False, "session": None}
        endpoints = {
            (method.upper(), path)
            for path, operations in app.openapi()["paths"].items()
            for method in operations
        }
        endpoints.update(
            (method, route.path)
            for route in app.routes
            if isinstance(route, Route)
            for method in route.methods or []
        )
        for method, template in sorted(endpoints):
            if (method, template) in PUBLIC:
                continue
            path = re.sub(r"\{[^}]+\}", "known-but-invalid-id", template)
            response = client.request(method, path, content=b"malformed private input")
            assert response.status_code == 401, (method, path, response.text)
            assert "no-store" in response.headers["cache-control"]
            assert response.headers["referrer-policy"] == "no-referrer"
            protected += 1
        assert protected > 40
        assert client.get("/docs").status_code == 401
        assert client.get("/openapi.json").status_code == 401


def test_origin_host_fetch_metadata_and_session_csrf_are_all_required(database: Database) -> None:
    app = create_app(database)
    with owner_client(app) as client:
        path = "/api/workflows/validate"
        csrf = client.headers.pop(CSRF_HEADER)
        assert client.post(path, json={}).status_code == 403
        assert client.post(path, json={}, headers={CSRF_HEADER: "incorrect"}).status_code == 403
        client.headers[CSRF_HEADER] = csrf
        # A valid session and CSRF admit the request to normal input validation.
        assert client.post(path, json={}).status_code == 422
        assert (
            client.post(path, json={}, headers={"Origin": "https://attacker.test"}).status_code
            == 403
        )
        origin = client.headers.pop("Origin")
        assert client.post(path, json={}).status_code == 403
        client.headers["Origin"] = origin
        assert client.get("/api/revisions", headers={"Host": "attacker.test"}).status_code == 400
        assert (
            client.get("/api/revisions", headers={"Host": "localhost:invalid"}).status_code == 400
        )
        assert (
            client.get("/api/revisions", headers={"Sec-Fetch-Site": "cross-site"}).status_code
            == 403
        )
        assert (
            client.get("/api/revisions", headers={"Sec-Fetch-Site": "same-site"}).status_code == 403
        )
        assert (
            client.get("/api/revisions", headers={"Sec-Fetch-Site": "same-origin"}).status_code
            == 200
        )
        assert (
            client.get(
                "/api/revisions",
                headers={"Host": "attacker.test", "X-Forwarded-Host": "127.0.0.1:3000"},
            ).status_code
            == 400
        )
        assert (
            client.post(path, json={}, headers=[("Origin", origin), ("Origin", origin)]).status_code
            == 403
        )
        assert (
            client.post(
                path, json={}, headers=[(CSRF_HEADER, csrf), (CSRF_HEADER, csrf)]
            ).status_code
            == 403
        )
        assert (
            client.post(path, json={}, headers=[(CSRF_HEADER.encode(), b"\xff")]).status_code == 403
        )


def test_secure_cookie_rotation_logout_and_validation_redaction(database: Database) -> None:
    access = AccessService(
        replace(AccessConfig.from_env(database), origin="https://research.example.test")
    )
    app = create_app(database, access=access)
    with anonymous(app) as client:
        client.headers["Origin"] = access.config.origin
        code = access.issue_link().get_secret_value()
        response = client.post("/api/access/exchange", json={"code": code})
        assert response.status_code == 200
        cookie = response.headers["set-cookie"]
        assert access.config.cookie_name.startswith("__Host-")
        assert all(value in cookie for value in ("HttpOnly", "Secure", "SameSite=strict", "Path=/"))
        assert "Domain=" not in cookie
        assert response.headers["strict-transport-security"] == "max-age=31536000"
        first_token = client.cookies.get(access.config.cookie_name)
        first_csrf = response.json()["session"]["csrf_token"]
        client.headers[CSRF_HEADER] = first_csrf
        response = client.post("/api/access/password", json={"password": PASSWORD})
        assert response.status_code == 200
        assert response.json()["password_enabled"]
        token = client.cookies.get(access.config.cookie_name)
        assert token != first_token
        assert not access.status(first_token).authenticated
        assert response.json()["session"]["csrf_token"] != first_csrf
        assert client.post("/api/access/logout").status_code == 403
        client.headers[CSRF_HEADER] = response.json()["session"]["csrf_token"]
        invalid = client.post(
            "/api/access/password",
            json={"password": "PRIVATE-SENTINEL", "unexpected": "PRIVATE-SENTINEL"},
        )
        assert invalid.status_code == 422
        assert "PRIVATE-SENTINEL" not in invalid.text
        assert client.post("/api/access/logout").status_code == 200
        assert not access.status(token).authenticated
        assert not client.cookies.get(access.config.cookie_name)
        assert client.get("/api/revisions").status_code == 401
        assert client.post("/api/access/exchange", json={"code": code}).status_code == 401
        assert client.post("/api/access/login", json={"password": PASSWORD}).status_code == 200


def test_http_expiry_and_revoke_all_remove_resource_access(database: Database) -> None:
    clock = [1_700_000_000]
    access = AccessService(
        replace(AccessConfig.from_env(database), idle_seconds=60, session_seconds=180),
        clock=lambda: clock[0],
    )
    app = create_app(database, access=access)
    with owner_client(app) as first, owner_client(app) as other:
        token = first.cookies.get(access.config.cookie_name)
        clock[0] += 59
        assert first.get("/api/access/status").json()["authenticated"]
        clock[0] += 1  # Status polling must not renew an idle session.
        assert first.get("/api/revisions").status_code == 401
        assert not access.status(token).authenticated
        assert other.get("/api/revisions").status_code == 401
    with owner_client(app) as first, owner_client(app) as other:
        assert first.post("/api/access/logout-all").status_code == 200
        assert other.get("/api/revisions").status_code == 401


def test_bounded_auth_bodies_and_persistent_login_throttle(database: Database) -> None:
    app = create_app(database)
    with owner_client(app) as client:
        response = client.post("/api/access/password", json={"password": PASSWORD})
        assert response.status_code == 200
        client.headers[CSRF_HEADER] = response.json()["session"]["csrf_token"]
        for headers, status in [
            ({"Content-Length": "4097"}, 413),
            ({"Content-Length": "-1"}, 400),
            ({"Content-Length": "invalid"}, 400),
        ]:
            assert (
                client.post("/api/access/login", content=b"x", headers=headers).status_code
                == status
            )

        def chunks() -> Iterator[bytes]:
            yield b'{"password":"'
            yield b"x" * 4096
            yield b'"}'

        assert client.post("/api/access/login", content=chunks()).status_code == 413
        response = client.post("/api/access/login", json={"password": "p" * 129})
        assert response.status_code == 422
        assert "p" * 129 not in response.text
        for _ in range(9):
            assert client.post("/api/access/login", json={"password": "wrong"}).status_code == 401
        blocked = client.post("/api/access/login", json={"password": "wrong"})
        assert blocked.status_code == 429 and blocked.headers["retry-after"] == "60"
        # A fresh app instance shares the limit; no process-local bypass.
        with anonymous(create_app(database)) as second:
            response = second.post(
                "/api/access/login",
                json={"password": PASSWORD},
                headers={"Origin": app.state.access.config.origin},
            )
            assert response.status_code == 429
        assert client.get("/api/revisions").status_code == 200  # Existing session survives.


def test_known_ids_hashes_exports_and_references_stay_in_the_owner_workspace(
    database: Database,
) -> None:
    record, guide, source, request = seeded(database)
    evaluation = dataset(database, case_for(source))
    app = create_app(database)
    paths = [
        f"/api/reports/{record.id}",
        f"/api/reports/{record.id}/export",
        f"/api/runs/{request.run_id}",
        f"/api/style-guides/{guide.id}",
        f"/api/evidence/{source.id}",
        f"/api/evaluations/datasets/{evaluation.id}",
        f"/api/artifacts/{source.artifact.id}/content",
    ]
    with owner_client(app) as owner:
        for path in paths:
            assert owner.get(path).status_code == 200, path
        original = owner.get(paths[-1]).content
        with anonymous(app) as guest:
            for path in paths:
                assert guest.get(path).status_code == 401, path
        with second_workspace(database) as other_database:
            other_app = create_app(other_database)
            with anonymous(other_app) as intruder:
                # Even copying the raw cookie under the other workspace's cookie name fails.
                intruder.cookies.set(
                    other_app.state.access.config.cookie_name,
                    owner.cookies.get(app.state.access.config.cookie_name),
                )
                assert intruder.get(paths[0]).status_code == 401
            with owner_client(other_app) as other:
                other.headers["X-ResearchChain-Workspace"] = app.state.access.config.workspace_id
                for path in paths:
                    assert other.get(path).status_code == 404, path
                assert other.get("/api/reports").json() == []
                assert other.get("/api/evidence").json()["total"] == 0
                references: list[tuple[str, dict[str, Any]]] = [
                    (
                        "/api/evidence",
                        {
                            "id": str(uuid4()),
                            "title": "Foreign original",
                            "kind": "text",
                            "text": "",
                            "rights": "owned",
                            "artifact_id": source.artifact.id,
                        },
                    ),
                    (
                        "/api/evaluations/datasets",
                        {
                            "id": str(uuid4()),
                            "title": "Foreign evidence",
                            "cases": [case_for(source).model_dump(mode="json")],
                        },
                    ),
                    (
                        "/api/reports",
                        request.model_copy(update={"id": uuid4()}).model_dump(mode="json"),
                    ),
                ]
                for path, body in references:
                    assert other.post(path, json=body).status_code == 404, path
                for action in ("recover", "cancel", "execute"):
                    assert other.post(f"/api/runs/{request.run_id}/{action}").status_code == 404
            assert owner.get(paths[-1]).content == original
            assert owner.get(paths[0]).json()["revision"]["id"] == str(record.id)


def test_app_rejects_access_service_for_another_workspace(database: Database) -> None:
    config = replace(AccessConfig.from_env(database), workspace_id="f" * 64)
    with pytest.raises(ValueError, match="workspace"):
        create_app(database, access=AccessService(config))


def test_health_failures_do_not_expose_database_details(
    database: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    app = create_app(database)
    with anonymous(app) as client:

        def unavailable(self: Database) -> None:
            raise RuntimeError("PRIVATE DATABASE DETAIL")

        monkeypatch.setattr(Database, "ready", unavailable)
        response = client.get("/api/health")
        assert response.status_code == 503
        assert response.json() == {"detail": "The service is not ready."}
