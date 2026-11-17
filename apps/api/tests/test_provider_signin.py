"""Exercise real loopback consent with synthetic OAuth and private credentials."""

import threading
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit
from uuid import uuid4

import httpx
import pytest
from access_fixtures import owner_client
from fastapi.testclient import TestClient
from test_chatgpt_provider import CLIENT, Harness
from test_research_runtime import FakeProvider

from researchchain.database import Database
from researchchain.main import create_app
from researchchain.provider_signin import SignInError, SignInService, SignInStatus
from researchchain.providers.chatgpt_auth import PendingLogin
from researchchain.providers.chatgpt_login import browser_login
from researchchain.providers.credentials import ConnectionError


class BrowserHarness:
    def __init__(self, directory: Path, *, lifetime: float = 600):
        self.oauth = Harness(directory)
        original = self.oauth.auth.begin

        def begin(*args: Any, **kwargs: Any) -> PendingLogin:
            pending = original(*args, **kwargs)
            pending.expires_at = time.monotonic() + lifetime
            self.oauth.pending = pending
            return pending

        self.oauth.auth.begin = begin
        self.calls = 0
        self.service = SignInService(self.run)

    def run(self, ready: Any, exchanging: Any, stop: threading.Event) -> Any:
        self.calls += 1
        return browser_login(
            self.oauth.auth,
            consent=True,
            open_browser=lambda url: None,
            announce=lambda message: None,
            ready=ready,
            exchanging=exchanging,
            stop=stop,
        )

    def wait(self, *states: str) -> SignInStatus:
        end = time.monotonic() + 5
        while time.monotonic() < end:
            status = self.service.status()
            if status.state in states:
                return status
            time.sleep(0.01)
        pytest.fail(f"Sign-in stayed {self.service.status().state}")

    def start(self) -> SignInStatus:
        self.service.start()
        return self.wait("waiting")

    def authorize(self, browser: httpx.Client) -> str:
        status = self.wait("waiting")
        assert status.url
        page = browser.get(status.url)
        assert page.status_code == 200
        assert "Continue with ChatGPT" in page.text
        parts = urlsplit(status.url)
        response = browser.post(
            status.url.replace("/start/", "/continue/"),
            headers={"Origin": f"{parts.scheme}://{parts.netloc}"},
        )
        assert response.status_code == 303
        params = parse_qs(urlsplit(response.headers["location"]).query)
        assert params["prompt"] == ["consent"]
        return (
            params["redirect_uri"][0]
            + "?"
            + urlencode(
                {
                    "state": params["state"][0],
                    "code": "synthetic-code",
                    "client_id": CLIENT,
                }
            )
        )


@pytest.fixture
def harness(tmp_path: Path) -> Iterator[BrowserHarness]:
    item = BrowserHarness(tmp_path / "auth")
    try:
        yield item
    finally:
        item.service.close()
        item.oauth.client.close()


def test_read_does_not_connect_and_concurrent_starts_reuse_listener(
    harness: BrowserHarness,
) -> None:
    assert harness.service.status().state == "idle"
    assert not harness.oauth.store.path.exists()
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: harness.service.start(), range(16)))
    assert len({result.id for result in results}) == 1
    pending = harness.wait("waiting")
    assert pending.url and pending.expires_at
    assert harness.calls == 1
    pending.message = "changed client copy"
    assert harness.service.status().message != pending.message
    assert "id_token" not in harness.service.status().model_dump_json()


def test_cancel_preserves_saved_account_and_closes_listener(harness: BrowserHarness) -> None:
    harness.oauth.complete()
    saved = harness.oauth.store.read()
    pending = harness.start()
    assert pending.id and pending.url
    assert harness.service.cancel(pending.id).state == "cancelling"
    ended = harness.wait("cancelled")
    assert ended.url is None and ended.expires_at is None
    assert harness.oauth.store.read() == saved
    assert len(harness.oauth.forms) == 1  # Only the initial synthetic connection.
    with pytest.raises(httpx.ConnectError):
        httpx.get(pending.url, trust_env=False)
    # An old tab must not cancel a newer flow.
    replacement = harness.start()
    assert replacement.id != pending.id
    with pytest.raises(SignInError, match="no longer current"):
        harness.service.cancel(pending.id)
    assert harness.service.status().state == "waiting"


def test_expiry_clears_link_and_does_not_exchange(tmp_path: Path) -> None:
    harness = BrowserHarness(tmp_path / "auth", lifetime=0.05)
    try:
        harness.service.start()
        assert harness.wait("expired").url is None
        assert harness.oauth.forms == []
    finally:
        harness.service.close()
        harness.oauth.client.close()


@pytest.mark.parametrize(
    "scopes, expected", [(None, "connected"), ("openid profile email", "plan_disabled")]
)
def test_success_and_declined_plan_permission(
    harness: BrowserHarness, scopes: str | None, expected: str
) -> None:
    if scopes is not None:
        harness.oauth.token_changes["scope"] = scopes
    harness.start()
    with httpx.Client(trust_env=False) as browser:
        callback = harness.authorize(browser)
        response = browser.get(callback)
        assert response.status_code == 200
    result = harness.wait(expected)
    assert result.url is None and result.expires_at is None
    assert "synthetic-code" not in result.model_dump_json()
    assert len(harness.oauth.forms) == 1
    assert harness.oauth.store.read().accounts[CLIENT].tokens


def test_denial_keeps_saved_connection_and_redacts_callback(
    harness: BrowserHarness, capsys: Any
) -> None:
    harness.oauth.complete()
    saved = harness.oauth.store.read()
    harness.start()
    with httpx.Client(trust_env=False) as browser:
        callback = harness.authorize(browser).replace("code=synthetic-code", "error=access_denied")
        response = browser.get(callback + "&error_description=secret-do-not-print")
        assert response.status_code == 400
        assert "secret-do-not-print" not in response.text
    result = harness.wait("failed")
    assert result.url is None
    assert harness.oauth.store.read() == saved
    assert len(harness.oauth.forms) == 1
    assert "secret-do-not-print" not in result.model_dump_json()
    assert capsys.readouterr() == ("", "")


def test_cancellation_during_exchange_reports_actual_completion(harness: BrowserHarness) -> None:
    entered, release = threading.Event(), threading.Event()
    complete = harness.oauth.auth.complete

    def blocked(*args: Any, **kwargs: Any) -> Any:
        entered.set()
        assert release.wait(5)
        return complete(*args, **kwargs)

    harness.oauth.auth.complete = blocked
    pending = harness.start()
    assert pending.id
    with httpx.Client(trust_env=False) as browser, ThreadPoolExecutor(max_workers=1) as pool:
        callback = harness.authorize(browser)
        future = pool.submit(browser.get, callback)
        try:
            assert entered.wait(5)
            assert harness.service.cancel(pending.id).state == "completing"
            assert harness.service.start().id == pending.id
        finally:
            release.set()
        assert future.result(timeout=5).status_code == 200
    assert harness.wait("connected").url is None


def test_shutdown_cancels_pending_and_rejects_new_flow(harness: BrowserHarness) -> None:
    harness.start()
    harness.service.close()
    assert harness.service.status().state == "cancelled"
    with pytest.raises(SignInError) as error:
        harness.service.start()
    assert error.value.status == 503


def test_unexpected_error_never_reveals_transport_details() -> None:
    def fail(*args: Any) -> Any:
        raise RuntimeError("secret-token-in-callback")

    service = SignInService(fail)
    service.start()
    service.close()
    assert service.status().state == "failed"
    assert "secret-token" not in service.status().model_dump_json()


@pytest.mark.parametrize(
    "url",
    [
        "https://attacker.invalid/start/a",
        "http://user@127.0.0.1:123/start/a",
        "http://127.0.0.1:123/start/a?token=secret",
    ],
)
def test_entry_link_must_be_local_without_credentials(url: str) -> None:
    def fail(ready: Any, *args: Any) -> Any:
        ready(url, time.monotonic() + 600)
        raise AssertionError("Invalid entry accepted")

    service = SignInService(fail)
    service.start()
    service.close()
    assert service.status().state == "failed"
    assert service.status().url is None


def test_api_requires_owner_origin_and_csrf(database: Database, harness: BrowserHarness) -> None:
    app = create_app(database, FakeProvider(), signin=harness.service)
    path = "/api/providers/chatgpt/sign-in"
    with TestClient(app, base_url="http://127.0.0.1:3000") as anonymous:
        assert anonymous.get(path).status_code == 401
        assert anonymous.post(path, headers={"Origin": "http://127.0.0.1:3000"}).status_code == 401
        with owner_client(app, workers=False) as owner:
            assert owner.get(path).json()["state"] == "idle"
            assert owner.post(path, headers={"X-ResearchChain-CSRF": ""}).status_code == 403
            assert (
                owner.post(path, headers={"Origin": "https://attacker.invalid"}).status_code == 403
            )
            assert harness.calls == 0
            result = owner.post(path)
            assert result.status_code == 200
            attempt = result.json()["id"]
            harness.wait("waiting")
            restored = owner.get(path)
            assert restored.json()["id"] == attempt
            assert "no-store" in restored.headers["cache-control"]
            assert owner.post(path).json()["id"] == attempt
            assert harness.calls == 1
            assert owner.post(f"{path}/{uuid4()}/cancel").status_code == 409
            assert owner.post(f"{path}/{attempt}/cancel").status_code == 200
            harness.wait("cancelled")


def test_injected_provider_cannot_accidentally_use_real_credentials(database: Database) -> None:
    with owner_client(create_app(database, FakeProvider()), workers=False) as client:
        path = "/api/providers/chatgpt/sign-in"
        assert client.get(path).json()["available"] is False
        assert client.post(path).status_code == 503


def test_remote_origin_disables_local_signin(
    database: Database, harness: BrowserHarness, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("RESEARCHCHAIN_PUBLIC_ORIGIN", "https://research.example.invalid")
    with owner_client(create_app(database, signin=harness.service), workers=False) as client:
        assert client.get("/api/providers/chatgpt/sign-in").json()["available"] is False
        assert client.post("/api/providers/chatgpt/sign-in").status_code == 503
    assert harness.calls == 0


def test_welcome_marker_failure_preserves_success(harness: BrowserHarness) -> None:
    write = harness.oauth.store.write

    def fail_marker(saved: Any) -> None:
        if any(account.welcomed for account in saved.accounts.values()):
            raise ConnectionError("Could not save welcome display metadata.")
        write(saved)

    harness.oauth.store.write = fail_marker
    harness.start()
    with httpx.Client(trust_env=False) as browser:
        assert browser.get(harness.authorize(browser)).status_code == 200
    assert harness.wait("connected").url is None
    assert harness.oauth.store.read().accounts[CLIENT].tokens is not None
