"""Bounded local sign-in sessions. Status never contains OAuth credentials."""

import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Literal, Protocol
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import httpx

from researchchain.models import StrictModel
from researchchain.providers.chatgpt_auth import PLAN_SCOPE, ChatGPTAuth
from researchchain.providers.chatgpt_login import LoginCancelled, LoginExpired, browser_login
from researchchain.providers.credentials import Account, ConnectionError, CredentialStore

SignInState = Literal[
    "idle",
    "starting",
    "waiting",
    "completing",
    "cancelling",
    "connected",
    "plan_disabled",
    "cancelled",
    "expired",
    "failed",
    "unavailable",
]


class SignInStatus(StrictModel):
    available: bool = True
    id: UUID | None = None
    state: SignInState = "idle"
    url: str | None = None
    expires_at: datetime | None = None
    message: str = "Start sign-in when you are ready."


class SignInError(ConnectionError):
    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


class LoginRunner(Protocol):
    def __call__(
        self,
        ready: Callable[[str, float], None],
        exchanging: Callable[[], bool],
        stop: threading.Event,
    ) -> Account: ...


def local_login(
    ready: Callable[[str, float], None],
    exchanging: Callable[[], bool],
    stop: threading.Event,
) -> Account:
    with httpx.Client(timeout=15, follow_redirects=False, trust_env=False) as client:
        return browser_login(
            ChatGPTAuth(CredentialStore(), client),
            consent=True,
            open_browser=lambda url: None,
            announce=lambda message: None,
            ready=ready,
            exchanging=exchanging,
            stop=stop,
        )


class SignInService:
    """One active listener per API process, created only by an explicit POST."""

    def __init__(self, runner: LoginRunner = local_login, *, enabled: bool = True):
        self._runner = runner
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._closed = False
        self._status = (
            SignInStatus()
            if enabled
            else SignInStatus(
                available=False,
                state="unavailable",
                message="ChatGPT sign-in is available in the local workbench.",
            )
        )

    def status(self) -> SignInStatus:
        with self._lock:
            return self._status.model_copy(deep=True)

    def start(self) -> SignInStatus:
        with self._lock:
            if not self._status.available or self._closed:
                raise SignInError("Local ChatGPT sign-in is unavailable.", 503)
            # Recover an ambiguous/lost response without creating another listener.
            if self._thread is not None and self._thread.is_alive():
                return self._status.model_copy(deep=True)
            self._stop = threading.Event()
            self._status = SignInStatus(
                id=uuid4(), state="starting", message="Preparing your sign-in page…"
            )
            self._thread = threading.Thread(target=self._run, name="chatgpt-signin", daemon=True)
            self._thread.start()
            return self._status.model_copy(deep=True)

    def cancel(self, attempt: UUID) -> SignInStatus:
        with self._lock:
            if self._status.id != attempt:
                raise SignInError("This sign-in is no longer current. Refresh its status.")
            # An exchange can already have committed credentials. Never claim that
            # cancellation undid it, or allow a replacement to race its completion.
            if self._status.state in {"starting", "waiting"}:
                self._stop.set()
                self._status = self._status.model_copy(
                    update={
                        "state": "cancelling",
                        "url": None,
                        "message": "Cancelling sign-in…",
                    }
                )
            return self._status.model_copy(deep=True)

    def close(self) -> None:
        with self._lock:
            self._closed = True
            if self._status.state in {"starting", "waiting", "cancelling"}:
                self._stop.set()
            thread = self._thread
        if thread is not None:
            # Pending listeners wake within 0.5s; an admitted exchange is allowed
            # to finish its bounded HTTP/credential-store operations.
            thread.join(timeout=60)

    def _ready(self, url: str, expires: float) -> None:
        parsed = urlsplit(url)
        if (
            parsed.scheme != "http"
            or parsed.hostname != "127.0.0.1"
            or not parsed.port
            or not parsed.path.startswith("/start/")
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ConnectionError("Could not prepare a local sign-in page.")
        with self._lock:
            if self._stop.is_set():
                raise LoginCancelled()
            self._status = self._status.model_copy(
                update={
                    "state": "waiting",
                    "url": url,
                    "expires_at": datetime.now(UTC)
                    + timedelta(seconds=max(0, expires - time.monotonic())),
                    "message": "Open the sign-in page, then continue with ChatGPT.",
                }
            )

    def _exchanging(self) -> bool:
        with self._lock:
            if self._stop.is_set():
                return False
            self._status = self._status.model_copy(
                update={
                    "state": "completing",
                    "url": None,
                    "message": "Finishing sign-in. Your account is being verified.",
                }
            )
            return True

    def _run(self) -> None:
        state: SignInState
        try:
            account = self._runner(self._ready, self._exchanging, self._stop)
            permitted = bool(
                account.tokens and {PLAN_SCOPE, "resource.invoke"} <= account.tokens.scopes
            )
            state = "connected" if permitted else "plan_disabled"
            message = (
                "ChatGPT connected. Plan usage is enabled."
                if permitted
                else "Signed in; plan usage is disabled. Start again to allow plan usage."
            )
        except LoginCancelled:
            state, message = "cancelled", "Sign-in cancelled. Your saved connection was kept."
        except LoginExpired:
            state, message = "expired", "Sign-in expired. Start again when you are ready."
        except ConnectionError as error:
            state, message = "failed", str(error)
        except Exception:
            # Do not return/log raw transport exceptions, callback URLs or tokens.
            state, message = (
                "failed",
                "Sign-in could not finish. Check your connection and try again.",
            )
        with self._lock:
            self._status = self._status.model_copy(
                update={
                    "state": state,
                    "url": None,
                    "expires_at": None,
                    "message": message,
                }
            )
