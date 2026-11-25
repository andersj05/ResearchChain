"""Official local-app ChatGPT registration, validation, renewal and sign-out."""

import base64
import hashlib
import re
import secrets
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from pydantic import SecretStr

from researchchain.providers.credentials import (
    Account,
    ConnectionError,
    CredentialStore,
    TokenSet,
)

ISSUER = "https://auth.openai.com"
RESOURCE = "https://api.openai.com/v1"
AUTHORIZE = f"{ISSUER}/api/accounts/authorize"
TOKEN = f"{ISSUER}/api/accounts/oauth/token"
JWKS = f"{ISSUER}/.well-known/jwks.json"
DISCOVERY = f"{ISSUER}/.well-known/openid-configuration"
PLAN_SCOPE = "chatgpt.tokens.use.direct"
SCOPES = f"openid profile email offline_access resource.invoke {PLAN_SCOPE}"
TERMINAL_REFRESH_ERRORS = {
    "invalid_grant",
    "invalid_refresh_token",
    "token_expired",
    "refresh_token_expired",
    "refresh_token_invalidated",
    "refresh_token_reused",
}


class ProviderError(ConnectionError):
    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        code: str | None = None,
        request_id: str | None = None,
        param: str | None = None,
        shape: str = "unknown",
    ):
        super().__init__(message)
        self.status = status
        self.code = code
        self.request_id = request_id
        self.param = param
        self.shape = shape


GENERIC_PROVIDER_ERROR = (
    "OpenAI could not complete the request. Credentials and billing choice were preserved."
)
PROVIDER_OVERLOAD_CODES = frozenset({"engine_overloaded", "overloaded", "server_is_overloaded"})
PROVIDER_OVERLOAD_MESSAGE = "OpenAI was overloaded and stopped the request."


def safe_identifier(value: Any) -> str | None:
    if isinstance(value, str) and re.fullmatch(r"[a-zA-Z0-9_.:/\[\]-]{1,200}", value):
        return value
    return None


def provider_error(response: httpx.Response) -> ProviderError:
    code = param = None
    shape = "non_json"
    try:
        body = response.json()
        shape = "object" if isinstance(body, dict) else "other_json"
        if isinstance(body, dict):
            error = body.get("error")
            if isinstance(error, dict):
                shape = "error_object"
                code = safe_identifier(error.get("code"))
                param = safe_identifier(error.get("param"))
            elif isinstance(error, str):
                shape = "oauth_error"
                code = safe_identifier(error)
            elif "detail" in body:
                shape = "detail"
    except ValueError:
        pass
    return error_for_code(
        code,
        status=response.status_code,
        param=param,
        shape=shape,
        request_id=safe_identifier(
            response.headers.get("x-request-id") or response.headers.get("openai-request-id")
        ),
    )


def error_for_code(code: str | None, **details: Any) -> ProviderError:
    if code == "subscription_sharing_usage_limit_exceeded":
        message = (
            "ChatGPT plan or app usage limit reached. Manage usage at "
            "https://chatgpt.com/settings/usage."
        )
    elif code == "subscription_sharing_user_not_eligible":
        message = "ChatGPT plan usage is unavailable for this account, workspace, or policy."
    elif code == "subscription_sharing_unsupported_capability":
        message = "This request uses a capability that ChatGPT plan access does not support."
    elif code in TERMINAL_REFRESH_ERRORS:
        message = "ChatGPT sign-in expired or was revoked. Continue with ChatGPT again."
    elif code in PROVIDER_OVERLOAD_CODES:
        message = PROVIDER_OVERLOAD_MESSAGE
    else:
        message = GENERIC_PROVIDER_ERROR
    return ProviderError(message, code=code, **details)


@dataclass(repr=False)
class PendingLogin:
    redirect_uri: str
    client_id: str
    host_id: str
    subject: str | None
    state: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    nonce: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    verifier: str = field(default_factory=lambda: secrets.token_urlsafe(64))
    browser_secret: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    expires_at: float = field(default_factory=lambda: time.monotonic() + 600)
    id_token_hint: str | None = None
    login_hint: str | None = None
    consent: bool = False
    consumed: bool = False

    def authorize_url(self) -> str:
        challenge = base64.urlsafe_b64encode(hashlib.sha256(self.verifier.encode()).digest())
        params = {
            "client_id": self.client_id,
            "ext_agent_host_id": self.host_id,
            "response_type": "code",
            "redirect_uri": self.redirect_uri,
            "scope": SCOPES,
            "resource": RESOURCE,
            "state": self.state,
            "nonce": self.nonce,
            "code_challenge_method": "S256",
            "code_challenge": challenge.rstrip(b"=").decode(),
        }
        if self.client_id == "dynamic_agent_client":
            params["agent_name_hint"] = "ResearchChain"
        if self.id_token_hint:
            params["id_token_hint"] = self.id_token_hint
        if self.login_hint:
            params["login_hint"] = self.login_hint
        if self.consent:
            params["prompt"] = "consent"
        return f"{AUTHORIZE}?{urlencode(params)}"


class ChatGPTAuth:
    def __init__(self, store: CredentialStore, client: httpx.Client):
        self.store = store
        self.client = client
        self.keys: dict[str, Any] | None = None
        self.keys_saved_at = 0.0

    def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        try:
            response = self.client.request(method, url, **kwargs)
        except httpx.HTTPError:
            raise ConnectionError(
                "Could not reach OpenAI. Try again when the connection is available."
            ) from None
        if response.status_code != 200:
            raise provider_error(response)
        return response

    def _json(self, method: str, url: str, **kwargs: Any) -> dict[str, Any]:
        response = self._request(method, url, **kwargs)
        try:
            body = response.json()
            if not isinstance(body, dict):
                raise ValueError
            return body
        except ValueError:
            raise ConnectionError("OpenAI returned an invalid response.") from None

    def begin(
        self,
        redirect_uri: str,
        account_id: str | None = None,
        *,
        new: bool = False,
        consent: bool = False,
    ) -> PendingLogin:
        if not re.fullmatch(r"http://127\.0\.0\.1:[0-9]{1,5}/auth/callback", redirect_uri):
            raise ConnectionError("Sign-in requires the local 127.0.0.1 callback.")
        with self.store.locked():
            saved = self.store.read()
            account_id = account_id or (None if new else saved.active_client_id)
            account = saved.accounts.get(account_id or "")
            if account_id and account is None:
                raise ConnectionError("Choose an existing ChatGPT account or add a new one.")
            self.store.write(saved)  # Persist this host before opening the browser.
            return PendingLogin(
                redirect_uri=redirect_uri,
                host_id=saved.host_id,
                client_id=account.client_id
                if account
                else (
                    "dynamic_agent_client"
                    if new
                    else saved.pending_client_id or "dynamic_agent_client"
                ),
                subject=account.subject if account else None,
                id_token_hint=(
                    account.tokens.id_token.get_secret_value()
                    if account and account.tokens
                    else None
                ),
                login_hint=account.email if account else None,
                consent=consent,
            )

    def _identity(self, token: str, client_id: str, nonce: str) -> dict[str, Any]:
        try:
            header = jwt.get_unverified_header(token)
            kid = header.get("kid")
            if not isinstance(kid, str) or header.get("alg") != "RS256":
                raise ValueError
            if self.keys is None or time.monotonic() - self.keys_saved_at > 300:
                self.keys = self._json("GET", JWKS)
                self.keys_saved_at = time.monotonic()
            matching = [key for key in self.keys.get("keys", []) if key.get("kid") == kid]
            if not matching:
                self.keys = self._json("GET", JWKS)  # Signing-key rotation.
                self.keys_saved_at = time.monotonic()
                matching = [key for key in self.keys.get("keys", []) if key.get("kid") == kid]
            if len(matching) != 1:
                raise ValueError
            key = jwt.PyJWK.from_dict(matching[0], algorithm="RS256")
            claims: dict[str, Any] = jwt.decode(
                token,
                key.key,
                algorithms=["RS256"],
                audience=client_id,
                issuer=ISSUER,
                leeway=5,
                options={"require": ["sub", "exp", "iat", "nonce"]},
            )
            if not isinstance(claims["sub"], str) or not claims["sub"]:
                raise ValueError
            if not isinstance(claims["nonce"], str) or not secrets.compare_digest(
                claims["nonce"], nonce
            ):
                raise ValueError
            # OIDC multi-audience tokens must name this client as the authorized party.
            if claims.get("azp", client_id) != client_id:
                raise ValueError
            if (
                isinstance(claims["aud"], list)
                and len(claims["aud"]) > 1
                and claims.get("azp") != client_id
            ):
                raise ValueError
            return claims
        except (jwt.PyJWTError, ValueError, TypeError, KeyError, AttributeError):
            raise ConnectionError(
                "Could not verify the ChatGPT account. Start a fresh sign-in."
            ) from None

    def _tokens(self, body: dict[str, Any], previous: TokenSet | None = None) -> TokenSet:
        try:
            names = ["access_token", "refresh_token"]
            if previous is None:
                names.extend(["id_token", "scope"])
            if any(not isinstance(body.get(name), str) or not body[name] for name in names):
                raise ValueError
            if str(body.get("token_type", "")).lower() != "bearer":
                raise ValueError
            expiry = body.get("expires_in")
            if isinstance(expiry, bool) or not isinstance(expiry, int) or not 0 < expiry <= 86400:
                raise ValueError
            scope = body.get("scope")
            if scope is not None and not isinstance(scope, str):
                raise ValueError
            return TokenSet(
                access_token=SecretStr(body["access_token"]),
                refresh_token=SecretStr(body["refresh_token"]),
                # Retain the validated sign-in identity token as the login hint.
                # Refresh tokens authenticate renewal; a returned ID token is not
                # used to change account identity without a new verified sign-in.
                id_token=previous.id_token if previous else SecretStr(body["id_token"]),
                scopes=frozenset(scope.split())
                if scope is not None
                else (previous.scopes if previous else frozenset()),
                expires_at=time.time() + expiry,
            )
        except (ValueError, TypeError):
            raise ConnectionError("OpenAI returned incomplete sign-in credentials.") from None

    def complete(self, pending: PendingLogin, query: dict[str, str]) -> Account:
        if pending.consumed or pending.expires_at <= time.monotonic():
            raise ConnectionError("This sign-in attempt expired or was already used. Start again.")
        if not secrets.compare_digest(query.get("state", ""), pending.state):
            raise ConnectionError("Sign-in state did not match. Start again.")
        pending.consumed = True
        if query.get("error"):
            raise ConnectionError("ChatGPT sign-in was declined or could not complete.")
        client_id = query.get("client_id", pending.client_id)
        if not re.fullmatch(r"oaiapp_[a-zA-Z0-9_-]{1,180}", client_id):
            raise ConnectionError("ChatGPT registration did not return an issued client ID.")
        if pending.client_id != "dynamic_agent_client" and client_id != pending.client_id:
            raise ConnectionError("The ChatGPT registration changed during sign-in.")
        code = query.get("code")
        if not code or len(code) > 8192:
            raise ConnectionError("ChatGPT sign-in did not return a valid authorization code.")
        if pending.subject is None:
            with self.store.locked():
                saved = self.store.read()
                saved.pending_client_id = client_id  # Retain registration if exchange needs retry.
                self.store.write(saved)
        body = self._json(
            "POST",
            TOKEN,
            data={
                "grant_type": "authorization_code",
                "client_id": client_id,
                "code": code,
                "code_verifier": pending.verifier,
                "redirect_uri": pending.redirect_uri,
                "resource": RESOURCE,
            },
        )
        tokens = self._tokens(body)
        identity = self._identity(tokens.id_token.get_secret_value(), client_id, pending.nonce)
        if pending.subject is not None and identity["sub"] != pending.subject:
            raise ConnectionError("This sign-in belongs to a different ChatGPT account.")
        with self.store.locked():
            saved = self.store.read()
            previous = saved.accounts.get(client_id)
            if previous and previous.subject != identity["sub"]:
                raise ConnectionError("The verified account does not match its saved registration.")
            account = Account(
                label=previous.label if previous else f"Account {len(saved.accounts) + 1}",
                subject=identity["sub"],
                client_id=client_id,
                email=identity.get("email") if isinstance(identity.get("email"), str) else None,
                tokens=tokens,
                welcomed=previous.welcomed if previous else False,
            )
            saved.accounts[client_id] = account
            saved.active_client_id = client_id
            if saved.pending_client_id == client_id:
                saved.pending_client_id = None
            self.store.write(saved)
        return account

    def access(self) -> tuple[str, str]:
        with self.store.locked():
            saved = self.store.read()
            account = saved.accounts.get(saved.active_client_id or "")
            if account is None or account.tokens is None:
                raise ConnectionError("Continue with ChatGPT before using a model.")
            tokens = account.tokens
            if PLAN_SCOPE not in tokens.scopes or "resource.invoke" not in tokens.scopes:
                raise ConnectionError(
                    "ChatGPT plan use is disabled. Sign in with --consent to enable it."
                )
            if tokens.expires_at <= time.time() + 60:
                try:
                    body = self._json(
                        "POST",
                        TOKEN,
                        data={
                            "grant_type": "refresh_token",
                            "client_id": account.client_id,
                            "refresh_token": tokens.refresh_token.get_secret_value(),
                            "resource": RESOURCE,
                        },
                    )
                except ProviderError as error:
                    if error.code in TERMINAL_REFRESH_ERRORS:
                        account.tokens = None
                        self.store.write(saved)
                    raise
                tokens = self._tokens(body, tokens)
                account.tokens = tokens
                self.store.write(saved)
                if PLAN_SCOPE not in tokens.scopes or "resource.invoke" not in tokens.scopes:
                    raise ConnectionError("ChatGPT plan permission is no longer enabled.")
            return account.client_id, tokens.access_token.get_secret_value()

    def sign_out(self, client_id: str) -> bool:
        confirmed = False
        with self.store.locked():
            saved = self.store.read()
            account = saved.accounts.get(client_id)
            if account is None:
                raise ConnectionError("Choose a saved ChatGPT account.")
            if account.tokens is not None:
                try:
                    discovery = self._json("GET", DISCOVERY)
                    endpoint = discovery.get("revocation_endpoint")
                    if (
                        discovery.get("issuer") != ISSUER
                        or endpoint != f"{ISSUER}/api/accounts/oauth/revoke"
                    ):
                        raise ConnectionError("Could not verify the token revocation endpoint.")
                    for attempt in range(2):
                        try:
                            self._request(
                                "POST",
                                endpoint,
                                data={
                                    "token": account.tokens.refresh_token.get_secret_value(),
                                    "token_type_hint": "refresh_token",
                                    "client_id": client_id,
                                },
                            )
                            confirmed = True
                            break
                        except ConnectionError:
                            if attempt == 0:
                                time.sleep(0.25)
                except ConnectionError:
                    pass
            else:
                confirmed = True
            account.tokens = None
            self.store.write(saved)  # Preserve registration/host for later reauthorization.
        return confirmed
