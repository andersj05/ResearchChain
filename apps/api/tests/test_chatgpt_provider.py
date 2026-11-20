import asyncio
import html
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from researchchain.providers.chatgpt_auth import (
    DISCOVERY,
    ISSUER,
    JWKS,
    PLAN_SCOPE,
    RESOURCE,
    SCOPES,
    TOKEN,
    ChatGPTAuth,
    PendingLogin,
    ProviderError,
)
from researchchain.providers.chatgpt_login import browser_login
from researchchain.providers.chatgpt_plan import ChatGPTPlan
from researchchain.providers.credentials import ConnectionError, CredentialStore
from researchchain.research import ChatGPTResearchProvider
from researchchain.research_prompt import json_bytes

CLIENT = "oaiapp_synthetic_test_registration"


class Harness:
    def __init__(self, directory: Path):
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.store = CredentialStore(directory)
        self.claims: dict[str, Any] = {}
        self.token_changes: dict[str, Any] = {}
        self.pending: PendingLogin | None = None
        self.forms: list[dict[str, list[str]]] = []
        self.fail_code: str | None = None
        self.fail_status = 400
        self.revoked = 0
        self.revocation_fails = False
        self.models: list[dict[str, Any]] = [
            {"slug": "test-model", "display_name": "Test model", "visibility": "list"},
            {"slug": "hidden", "display_name": "Hidden", "visibility": "hide"},
        ]
        self.client = httpx.Client(transport=httpx.MockTransport(self.handle))
        self.auth = ChatGPTAuth(self.store, self.client)

    def handle(self, request: httpx.Request) -> httpx.Response:
        if str(request.url) == JWKS:
            key = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key()))
            return httpx.Response(200, json={"keys": [{**key, "kid": "test-key", "alg": "RS256"}]})
        if str(request.url) == DISCOVERY:
            return httpx.Response(
                200,
                json={
                    "issuer": ISSUER,
                    "revocation_endpoint": f"{ISSUER}/api/accounts/oauth/revoke",
                },
            )
        if request.url.path.endswith("/oauth/revoke"):
            self.revoked += 1
            return httpx.Response(503 if self.revocation_fails else 200)
        if str(request.url) == TOKEN:
            form = parse_qs(request.content.decode())
            self.forms.append(form)
            if self.fail_code:
                return httpx.Response(
                    self.fail_status,
                    json={"error": self.fail_code, "error_description": "secret-do-not-print"},
                )
            assert self.pending is not None
            identity = jwt.encode(
                {
                    "iss": ISSUER,
                    "sub": "test-subject",
                    "aud": form["client_id"][0],
                    "nonce": self.pending.nonce,
                    "exp": int(time.time()) + 3600,
                    "iat": int(time.time()),
                    "email": "synthetic@example.invalid",
                    **self.claims,
                },
                self.key,
                algorithm="RS256",
                headers={"kid": "test-key"},
            )
            return httpx.Response(
                200,
                json={
                    "access_token": f"synthetic-access-{len(self.forms)}",
                    "refresh_token": f"synthetic-refresh-{len(self.forms)}",
                    "id_token": identity,
                    "token_type": "Bearer",
                    "expires_in": 3600,
                    "scope": SCOPES,
                    **self.token_changes,
                },
            )
        if str(request.url) == f"{RESOURCE}/models":
            assert request.headers["authorization"].startswith("Bearer synthetic-access-")
            return httpx.Response(200, json={"models": self.models})
        raise AssertionError("Unexpected network route")

    def begin(self, **kwargs: Any) -> PendingLogin:
        self.pending = self.auth.begin("http://127.0.0.1:1455/auth/callback", **kwargs)
        return self.pending

    def complete(self, **callback: str) -> Any:
        pending = self.pending or self.begin()
        return self.auth.complete(
            pending,
            {"state": pending.state, "code": "synthetic-code", "client_id": CLIENT, **callback},
        )

    def expire(self) -> None:
        with self.store.locked():
            saved = self.store.read()
            account = saved.accounts[CLIENT]
            assert account.tokens
            account.tokens.expires_at = 0
            self.store.write(saved)


@pytest.fixture
def harness(tmp_path: Path) -> Harness:
    return Harness(tmp_path / "auth")


def test_private_atomic_storage_and_stable_host(harness: Harness) -> None:
    first = harness.begin()
    second = harness.begin()
    assert first.host_id == second.host_id
    assert first.state != second.state and first.nonce != second.nonce
    account = harness.complete()
    assert account.tokens
    assert "synthetic-access" not in repr(account)
    assert "synthetic-access" not in account.model_dump_json()
    if os.name == "nt":
        assert b"synthetic-access" not in harness.store.path.read_bytes()
    else:
        assert harness.store.path.stat().st_mode & 0o777 == 0o600
    fresh = CredentialStore(harness.store.directory)
    with fresh.locked():
        restored = fresh.read()
    assert restored.accounts[CLIENT].tokens.access_token.get_secret_value() == "synthetic-access-1"
    assert list(harness.store.directory.glob(".chatgpt-*")) == []


def test_pkce_registration_and_exact_exchange(harness: Harness) -> None:
    pending = harness.begin()
    params = parse_qs(urlsplit(pending.authorize_url()).query)
    assert params["client_id"] == ["dynamic_agent_client"]
    assert params["agent_name_hint"] == ["ResearchChain"]
    assert params["code_challenge_method"] == ["S256"]
    assert PLAN_SCOPE in params["scope"][0].split()
    harness.complete()
    assert harness.forms[0]["client_id"] == [CLIENT]
    assert harness.forms[0]["redirect_uri"] == [pending.redirect_uri]
    assert harness.forms[0]["code_verifier"] == [pending.verifier]
    assert harness.forms[0]["resource"] == [RESOURCE]
    returning = harness.begin()
    params = parse_qs(urlsplit(returning.authorize_url()).query)
    assert params["client_id"] == [CLIENT] and "agent_name_hint" not in params
    assert "id_token_hint" in params and "prompt" not in params
    harness.auth.complete(returning, {"state": returning.state, "code": "synthetic-again"})
    assert len(harness.store.read().accounts) == 1


@pytest.mark.parametrize(
    "change",
    [
        {"aud": "other-client"},
        {"iss": "https://untrusted.invalid"},
        {"sub": ""},
        {"nonce": "wrong"},
        {"exp": 1},
        {"iat": int(time.time()) + 86400},
        {"aud": [CLIENT, "other-client"]},
        {"azp": "other-client"},
    ],
)
def test_id_claims_fail_closed(harness: Harness, change: dict[str, Any]) -> None:
    harness.claims = change
    with pytest.raises(ConnectionError, match="verify"):
        harness.complete()
    assert harness.store.read().active_client_id is None


def test_untrusted_signature_rejected(harness: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    harness.begin()
    harness.auth._json("GET", JWKS)
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    original = harness.handle

    def fake(request: httpx.Request) -> httpx.Response:
        response = original(request)
        if str(request.url) == JWKS:
            key = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(other_key.public_key()))
            return httpx.Response(200, json={"keys": [{**key, "kid": "test-key"}]})
        return response

    harness.auth.client = httpx.Client(transport=httpx.MockTransport(fake))
    with pytest.raises(ConnectionError, match="verify"):
        harness.complete()


@pytest.mark.parametrize(
    "callback",
    [{"state": "wrong"}, {"error": "access_denied"}, {"client_id": "dynamic_agent_client"}],
)
def test_invalid_callbacks_never_exchange(harness: Harness, callback: dict[str, str]) -> None:
    with pytest.raises(ConnectionError):
        harness.complete(**callback)
    assert not harness.forms


def test_expired_and_replayed_callback(harness: Harness) -> None:
    harness.begin().expires_at = 0
    with pytest.raises(ConnectionError, match="expired"):
        harness.complete()
    harness.begin()
    harness.complete()
    with pytest.raises(ConnectionError, match="already used"):
        harness.complete()
    assert len(harness.forms) == 1


def test_mismatched_returning_account_preserves_connection(harness: Harness) -> None:
    harness.complete()
    harness.begin()
    with pytest.raises(ConnectionError, match="registration changed"):
        harness.complete(client_id="oaiapp_other")
    harness.begin()
    harness.claims = {"sub": "someone-else"}
    with pytest.raises(ConnectionError, match="different ChatGPT account"):
        harness.complete()
    assert harness.store.read().accounts[CLIENT].subject == "test-subject"


def test_registration_retained_after_failed_exchange(harness: Harness) -> None:
    harness.fail_code = "invalid_grant"
    with pytest.raises(ProviderError):
        harness.complete()
    assert harness.begin().client_id == CLIENT
    assert not harness.store.read().accounts


def test_separate_workspace_registrations_even_same_email(harness: Harness) -> None:
    harness.complete()
    harness.begin(new=True)
    other = harness.complete(client_id="oaiapp_otherworkspace")
    saved = harness.store.read()
    assert len(saved.accounts) == 2
    assert other.label == "Account 2" and saved.active_client_id == other.client_id
    assert saved.accounts[CLIENT].tokens.access_token.get_secret_value() == "synthetic-access-1"


def test_granted_scopes_control_plan_not_callback(harness: Harness) -> None:
    harness.token_changes = {"scope": "openid profile email offline_access"}
    harness.complete(scope=SCOPES)
    with pytest.raises(ConnectionError, match="disabled"):
        harness.auth.access()
    assert "prompt=consent" in harness.begin(consent=True).authorize_url()


def test_refresh_is_rotated_once_across_concurrent_clients(harness: Harness) -> None:
    harness.complete()
    harness.expire()
    clients = [
        ChatGPTAuth(CredentialStore(harness.store.directory), harness.client) for _ in range(2)
    ]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda auth: auth.access(), clients))
    assert results == [(CLIENT, "synthetic-access-2")] * 2
    assert len(harness.forms) == 2
    assert "scope" not in harness.forms[-1]
    assert (
        harness.store.read().accounts[CLIENT].tokens.refresh_token.get_secret_value()
        == "synthetic-refresh-2"
    )


@pytest.mark.parametrize(
    "code,cleared",
    [("invalid_grant", True), ("invalid_client", False), ("temporary_unavailable", False)],
)
def test_refresh_error_preserves_registration(harness: Harness, code: str, cleared: bool) -> None:
    harness.complete()
    harness.expire()
    harness.fail_code = code
    with pytest.raises(ProviderError) as error:
        harness.auth.access()
    assert "secret-do-not-print" not in str(error.value)
    saved = harness.store.read()
    assert (saved.accounts[CLIENT].tokens is None) == cleared
    assert saved.active_client_id == CLIENT
    assert harness.begin().client_id == CLIENT


@pytest.mark.parametrize("fails", [True, False])
def test_signout_revokes_and_clears_credentials(harness: Harness, fails: bool) -> None:
    harness.complete()
    harness.revocation_fails = fails
    assert harness.auth.sign_out(CLIENT) is not fails
    assert harness.revoked == (2 if fails else 1)
    assert harness.store.read().accounts[CLIENT].tokens is None
    assert "id_token_hint" not in harness.begin().authorize_url()


def test_loopback_browser_binding_and_success(harness: Harness) -> None:
    threads = []
    pages = []
    original_begin = harness.auth.begin

    def begin(*args: Any, **kwargs: Any) -> PendingLogin:
        harness.pending = original_begin(*args, **kwargs)
        return harness.pending

    harness.auth.begin = begin

    def open_browser(url: str) -> None:
        def visit() -> None:
            with httpx.Client(trust_env=False) as browser:
                page = browser.get(url)
                assert page.status_code == 200
                assert "HttpOnly" in page.headers["set-cookie"]
                assert "no-store" == page.headers["cache-control"]
                start = urlsplit(url)
                action = url.replace("/start/", "/continue/")
                origin = f"{start.scheme}://{start.netloc}"
                denied = browser.post(action, headers={"Origin": "https://untrusted.invalid"})
                assert denied.status_code == 403
                # The rejected request clears the cookie; restart the same local entry page.
                browser.get(url)
                redirect = browser.post(action, headers={"Origin": origin})
                assert redirect.status_code == 303
                query = parse_qs(urlsplit(redirect.headers["location"]).query)
                callback = (
                    query["redirect_uri"][0]
                    + "?"
                    + urlencode(
                        {
                            "state": query["state"][0],
                            "client_id": CLIENT,
                            "code": "synthetic-code",
                        }
                    )
                )
                pages.append(browser.get(callback))

        thread = threading.Thread(target=visit)
        thread.start()
        threads.append(thread)

    account = browser_login(harness.auth, open_browser=open_browser, announce=lambda message: None)
    for thread in threads:
        thread.join(timeout=5)
    assert account.client_id == CLIENT
    assert pages[0].status_code == 200
    assert "You're using your ChatGPT plan" in html.unescape(pages[0].text)
    assert "synthetic-access" not in html.unescape(pages[0].text)


def events(*items: dict[str, Any]) -> bytes:
    return b"".join(b"data: " + json.dumps(item).encode() + b"\n\n" for item in items)


def test_account_status_projects_only_advertised_model_controls(
    harness: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    harness.complete()
    common = {"display_name": "Fixture", "visibility": "list"}
    harness.models = [
        {
            **common,
            "slug": "advertised",
            "supported_reasoning_levels": [
                {"effort": "high", "description": "Nested catalog metadata"},
                {"effort": "none"},
                {"effort": "high"},
                {"effort": "future"},
                {"effort": []},
                {"level": "low"},
                "medium",
                None,
            ],
            "default_reasoning_level": "none",
            "support_verbosity": True,
            "default_verbosity": "medium",
        },
        {**common, "slug": "legacy"},
        {
            **common,
            "slug": "malformed",
            "supported_reasoning_levels": {"effort": "high"},
            "default_reasoning_level": "high",
            "support_verbosity": 1,
            "default_verbosity": "low",
        },
        {
            **common,
            "slug": "unknown-defaults",
            "supported_reasoning_levels": [{"effort": "low"}],
            "default_reasoning_level": "medium",
            "support_verbosity": True,
            "default_verbosity": {},
        },
        {**common, "slug": "hidden", "visibility": "hide", "support_verbosity": True},
    ]
    client = httpx.Client
    monkeypatch.setattr(
        httpx,
        "Client",
        lambda **kwargs: client(transport=httpx.MockTransport(harness.handle), **kwargs),
    )
    status = ChatGPTResearchProvider(harness.store).status()
    assert status.error is None and status.accounts[0].id == CLIENT
    models = {item.slug: item for item in status.models}
    assert list(models) == ["advertised", "legacy", "malformed", "unknown-defaults"]
    assert models["advertised"].reasoning_efforts == ["high", "none"]
    assert models["advertised"].default_reasoning_effort == "none"
    assert (
        models["advertised"].supports_verbosity
        and models["advertised"].default_verbosity == "medium"
    )
    for slug in ("legacy", "malformed"):
        assert models[slug].reasoning_efforts == []
        assert models[slug].default_reasoning_effort is None
        assert not models[slug].supports_verbosity and models[slug].default_verbosity is None
    assert models["unknown-defaults"].reasoning_efforts == ["low"]
    assert models["unknown-defaults"].default_reasoning_effort is None
    assert (
        models["unknown-defaults"].supports_verbosity
        and models["unknown-defaults"].default_verbosity is None
    )


def test_duplicate_catalog_rows_share_only_common_capabilities(harness: Harness) -> None:
    harness.complete()
    source = {
        "slug": "duplicate",
        "display_name": "First display name",
        "visibility": "list",
        "supported_reasoning_levels": [{"effort": "low"}, {"effort": "high"}],
        "default_reasoning_level": "high",
        "support_verbosity": True,
        "default_verbosity": "low",
    }
    harness.models = [source, dict(source)]
    plan = ChatGPTPlan(harness.auth)
    account, choices = plan.models()
    assert account == CLIENT and len(choices) == 1
    assert (
        choices[0].reasoning_efforts == ("low", "high")
        and choices[0].default_reasoning_effort == "high"
    )
    assert choices[0].supports_verbosity and choices[0].default_verbosity == "low"
    harness.models.append(
        {
            **source,
            "display_name": "Second display name",
            "supported_reasoning_levels": [{"effort": "medium"}, {"effort": "low"}],
            "default_reasoning_level": "low",
            "support_verbosity": False,
        }
    )
    _, choices = plan.models()
    assert len(choices) == 1 and choices[0].display_name == "First display name"
    assert choices[0].reasoning_efforts == ("low",) and choices[0].default_reasoning_effort is None
    assert not choices[0].supports_verbosity and choices[0].default_verbosity is None


@pytest.mark.parametrize("analyst", [False, True])
def test_saved_research_request_matches_http_bytes(harness: Harness, analyst: bool) -> None:
    harness.complete()
    schema = {"type": "object", "properties": {}, "additionalProperties": False}
    saved: dict[str, Any] = {
        "model": "test-model",
        "store": False,
        "stream": True,
        "instructions": "Use checked sources.",
        "input": [{"role": "user", "content": [{"type": "input_text", "text": "Résumé"}]}],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "research_result",
                "strict": True,
                "schema": schema,
            },
            "verbosity": "low",
        },
        "reasoning": {"effort": "high"},
    }
    if analyst:
        saved["reasoning"]["summary"] = "auto"
        saved["input"].append(
            {
                "type": "reasoning",
                "id": "synthetic-item",
                "summary": [],
                "encrypted_content": "synthetic-opaque-item",
            }
        )
        saved["tools"] = [{"type": "web_search"}]
        saved["include"] = ["web_search_call.action.sources", "reasoning.encrypted_content"]
    expected = json_bytes(saved)

    def handle(request: httpx.Request) -> httpx.Response:
        assert request.url == f"{RESOURCE}/responses"
        assert request.headers["content-type"] == "application/json"
        assert request.content == expected
        return httpx.Response(
            200,
            content=events(
                {"type": "response.output_text.delta", "delta": "ok"},
                {
                    "type": "response.completed",
                    "response": {"id": "resp_test", "status": "completed"},
                },
            ),
        )

    response = asyncio.run(
        ChatGPTPlan(harness.auth).complete(
            "test-model",
            "",
            account_id=CLIENT,
            request_body=saved,
            web_search=analyst,
            analyst_options={} if analyst else None,
            transport=httpx.MockTransport(handle),
        )
    )
    assert response.text == "ok" and (response.analyst_response is not None) == analyst


@pytest.mark.parametrize("change", [{"model": "another"}, {"stream": False}, {"store": True}])
def test_saved_request_checks_model_and_plan_boundaries_before_access(
    harness: Harness, change: dict[str, Any]
) -> None:
    body = {"model": "test-model", "stream": True, "store": False, **change}
    with pytest.raises(ValueError, match="pinned model"):
        asyncio.run(
            ChatGPTPlan(harness.auth).complete(
                "test-model", "", account_id=CLIENT, request_body=body
            )
        )
    assert harness.forms == []


def run_response(harness: Harness, content: bytes, **kwargs: Any) -> Any:
    harness.complete()
    plan = ChatGPTPlan(harness.auth)
    account, models = plan.models()
    assert [model.slug for model in models] == ["test-model"]

    def handle(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body == {
            "model": "test-model",
            "input": [{"role": "user", "content": "test"}],
            "store": False,
            "stream": True,
        }
        assert request.url == f"{RESOURCE}/responses"
        return httpx.Response(200, content=content, headers={"content-type": "text/event-stream"})

    return asyncio.run(
        plan.complete(
            "test-model",
            "test",
            account_id=account,
            transport=httpx.MockTransport(handle),
            **kwargs,
        )
    )


def test_plan_response_requires_completed_terminal_event(harness: Harness) -> None:
    result = run_response(
        harness,
        events(
            {"type": "response.output_text.delta", "delta": "ok"},
            {
                "type": "response.completed",
                "response": {
                    "status": "completed",
                    "id": "resp_test",
                    "usage": {"input_tokens": 3},
                },
            },
        ),
        timeout_seconds=600,
    )
    assert result.text == "ok" and result.usage == {"input_tokens": 3}


def test_response_rejects_time_above_configurable_limit(harness: Harness) -> None:
    with pytest.raises(ValueError, match="bounded time"):
        run_response(harness, b"", timeout_seconds=601)


@pytest.mark.parametrize(
    "ending", [b"", events({"type": "response.incomplete"}), b"data: invalid\n\n"]
)
def test_partial_or_invalid_stream_never_succeeds(harness: Harness, ending: bytes) -> None:
    with pytest.raises(ConnectionError):
        run_response(
            harness, events({"type": "response.output_text.delta", "delta": "partial"}) + ending
        )


def test_quota_error_after_partial_stream_is_preserved(harness: Harness) -> None:
    with pytest.raises(ProviderError) as caught:
        run_response(
            harness,
            events(
                {"type": "response.output_text.delta", "delta": "partial"},
                {
                    "type": "response.failed",
                    "response": {
                        "error": {
                            "code": "subscription_sharing_usage_limit_exceeded",
                            "message": "secret",
                        }
                    },
                },
            ),
        )
    assert caught.value.code == "subscription_sharing_usage_limit_exceeded"
    assert "settings/usage" in str(caught.value) and "secret" not in str(caught.value)


def test_output_budget_stops_inference(harness: Harness) -> None:
    with pytest.raises(ConnectionError, match="output limit"):
        run_response(
            harness,
            events({"type": "response.output_text.delta", "delta": "too much"}),
            output_chars=2,
        )


def test_absolute_stream_timeout_closes_transport(harness: Harness) -> None:
    harness.complete()
    closed = []

    class SlowStream(httpx.AsyncByteStream):
        async def __aiter__(self) -> Any:
            await asyncio.sleep(10)
            yield b"data: {}\n\n"

        async def aclose(self) -> None:
            closed.append(True)

    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200,
            stream=SlowStream(),
            headers={"content-type": "text/event-stream"},
        )
    )
    with pytest.raises(ConnectionError, match="timed out"):
        asyncio.run(
            ChatGPTPlan(harness.auth).complete(
                "test-model",
                "test",
                account_id=CLIENT,
                timeout_seconds=0.01,
                transport=transport,
            )
        )
    assert closed


@pytest.mark.parametrize(
    "status,body,shape,code",
    [
        (403, {"detail": "private upstream diagnostic"}, "detail", None),
        (
            429,
            {
                "error": {
                    "code": "subscription_sharing_usage_limit_exceeded",
                    "param": "model",
                    "message": "private upstream diagnostic",
                }
            },
            "error_object",
            "subscription_sharing_usage_limit_exceeded",
        ),
    ],
)
def test_admission_errors_preserve_safe_diagnostics(
    harness: Harness,
    status: int,
    body: dict[str, Any],
    shape: str,
    code: str | None,
) -> None:
    harness.complete()
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            status,
            json=body,
            headers={"x-request-id": "request-test-123"},
        )
    )
    with pytest.raises(ProviderError) as caught:
        asyncio.run(
            ChatGPTPlan(harness.auth).complete(
                "test-model",
                "test",
                account_id=CLIENT,
                transport=transport,
            )
        )
    assert caught.value.status == status and caught.value.shape == shape
    assert caught.value.code == code and caught.value.request_id == "request-test-123"
    assert "private upstream" not in str(caught.value)
    assert harness.store.read().accounts[CLIENT].tokens is not None


def test_account_switch_between_selection_and_request_stops_call(harness: Harness) -> None:
    harness.complete()
    account, _ = ChatGPTPlan(harness.auth).models()
    harness.begin(new=True)
    harness.complete(client_id="oaiapp_second")
    with pytest.raises(ConnectionError, match="account changed"):
        asyncio.run(ChatGPTPlan(harness.auth).complete("test-model", "test", account_id=account))


def test_missing_content_type_still_requires_a_completed_sse_response(harness: Harness) -> None:
    harness.complete()
    content = events(
        {"type": "response.output_text.delta", "delta": "ok"},
        {"type": "response.completed", "response": {"id": "resp_test", "status": "completed"}},
    )
    transport = httpx.MockTransport(lambda request: httpx.Response(200, content=content))
    result = asyncio.run(
        ChatGPTPlan(harness.auth).complete(
            "test-model",
            "test",
            account_id=CLIENT,
            transport=transport,
        )
    )
    assert result.text == "ok"
    invalid = httpx.MockTransport(
        lambda request: httpx.Response(200, content=b"<html>not a response</html>")
    )
    with pytest.raises(ConnectionError, match="without response.completed"):
        asyncio.run(
            ChatGPTPlan(harness.auth).complete(
                "test-model",
                "test",
                account_id=CLIENT,
                transport=invalid,
            )
        )
