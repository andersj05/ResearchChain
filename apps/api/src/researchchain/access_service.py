"""Owner authentication, single-use setup links, and server-enforced sessions."""

import hashlib
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Never

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from pydantic import SecretStr

from researchchain.access_config import AccessConfig
from researchchain.access_models import (
    AccessError,
    AccessGrant,
    AccessState,
    AccessStatus,
    OwnerSession,
    SessionRecord,
)
from researchchain.access_store import AccessStore

HASHER = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)
LOGIN_WINDOW = 60
LOGIN_FAILURES = 10
RECENT_AUTH = 300


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


@dataclass(frozen=True)
class IssuedSession:
    token: SecretStr = field(repr=False)
    status: AccessStatus


class AccessService:
    def __init__(self, config: AccessConfig, clock: Callable[[], float] = time.time):
        self.config = config
        self.store = AccessStore(config)
        self.clock = clock

    def now(self) -> int:
        return int(self.clock())

    def prune(self, state: AccessState, now: int) -> None:
        state.grants = {
            key: value
            for key, value in state.grants.items()
            if value.created_at <= now + 30 and value.expires_at > now
        }
        state.sessions = {
            key: value
            for key, value in state.sessions.items()
            if value.created_at <= now + 30
            and value.expires_at > now
            and value.last_seen + self.config.idle_seconds > now
        }
        state.failures = [stamp for stamp in state.failures if now - LOGIN_WINDOW < stamp <= now]

    def issue_link(self, owner_name: str | None = None) -> SecretStr:
        """Local operator only. Never expose this operation as an HTTP endpoint."""
        with self.store.locked():
            state = self.store.read() or AccessState(workspace_id=self.config.workspace_id)
            if owner_name is not None:
                if not owner_name.strip() or len(owner_name) > 100:
                    raise AccessError("Choose an owner name of 1–100 characters.", 422)
                state.owner_name = owner_name.strip()
            now = self.now()
            self.prune(state, now)
            state.grants = {
                key: value
                for key, value in state.grants.items()
                if value.origin != self.config.origin
            }
            if len(state.grants) >= 5:
                oldest = min(state.grants, key=lambda key: state.grants[key].created_at)
                del state.grants[oldest]
            code = secrets.token_urlsafe(32)
            state.grants[digest(code)] = AccessGrant(
                origin=self.config.origin,
                created_at=now,
                expires_at=now + self.config.grant_seconds,
            )
            state.failures = []
            self.store.write(state)
            return SecretStr(code)

    def session_record(self, state: AccessState, token: str | None) -> SessionRecord | None:
        record = state.sessions.get(digest(token)) if token and len(token) <= 128 else None
        return record if record and record.origin == self.config.origin else None

    def status_value(self, state: AccessState | None, record: SessionRecord | None) -> AccessStatus:
        enabled = bool(state and state.password_hash)
        session = None
        if state and record:
            session = OwnerSession(
                owner_id=state.owner_id,
                owner_name=state.owner_name,
                workspace_id=state.workspace_id,
                csrf_token=record.csrf,
                expires_at=datetime.fromtimestamp(record.expires_at, UTC),
                idle_expires_at=datetime.fromtimestamp(
                    record.last_seen + self.config.idle_seconds,
                    UTC,
                ),
                password_enabled=enabled,
                recent_authentication=record.created_at + RECENT_AUTH > self.now(),
            )
        return AccessStatus(
            authenticated=session is not None, password_enabled=enabled, session=session
        )

    def status(self, token: str | None, *, touch: bool = False) -> AccessStatus:
        with self.store.locked():
            state = self.store.read()
            if state is None:
                return self.status_value(None, None)
            now = self.now()
            before = state.model_dump_json()
            self.prune(state, now)
            record = self.session_record(state, token)
            if record and touch and now > record.last_seen:
                record.last_seen = now
            if state.model_dump_json() != before:
                self.store.write(state)
            return self.status_value(state, record)

    def failed(self, state: AccessState, now: int) -> Never:
        if len(state.failures) < LOGIN_FAILURES:
            state.failures.append(now)
            self.store.write(state)
        if len(state.failures) >= LOGIN_FAILURES:
            raise AccessError("Too many sign-in attempts. Try again in one minute.", 429)
        raise AccessError("Sign-in was not accepted. Check the password or open a new owner link.")

    def new_session(
        self,
        state: AccessState,
        now: int,
        old_token: str | None = None,
    ) -> IssuedSession:
        if old_token:
            state.sessions.pop(digest(old_token), None)
        if len(state.sessions) >= 16:
            oldest = min(state.sessions, key=lambda key: state.sessions[key].created_at)
            del state.sessions[oldest]
        token = secrets.token_urlsafe(32)
        record = SessionRecord(
            origin=self.config.origin,
            created_at=now,
            last_seen=now,
            expires_at=now + self.config.session_seconds,
            csrf=secrets.token_urlsafe(32),
        )
        state.sessions[digest(token)] = record
        state.failures = []
        self.store.write(state)
        return IssuedSession(SecretStr(token), self.status_value(state, record))

    def exchange(self, code: str, old_token: str | None = None) -> IssuedSession:
        with self.store.locked():
            state = self.store.read()
            if state is None:
                raise AccessError("Open a new owner sign-in link from the local command.")
            now = self.now()
            self.prune(state, now)
            grant = state.grants.pop(digest(code), None)
            if not grant or grant.origin != self.config.origin:
                self.failed(state, now)
            return self.new_session(state, now, old_token)

    def login(self, password: str, old_token: str | None = None) -> IssuedSession:
        with self.store.locked():
            state = self.store.read()
            if state is None:
                raise AccessError("Sign-in was not accepted. Open an owner setup link.")
            now = self.now()
            self.prune(state, now)
            if len(state.failures) >= LOGIN_FAILURES:
                raise AccessError("Too many sign-in attempts. Try again in one minute.", 429)
            if not state.password_hash or not 1 <= len(password) <= 128:
                self.failed(state, now)
            try:
                assert state.password_hash
                HASHER.verify(state.password_hash, password)
            except VerificationError:
                self.failed(state, now)
            if HASHER.check_needs_rehash(state.password_hash):
                state.password_hash = HASHER.hash(password)
            return self.new_session(state, now, old_token)

    def set_password(
        self,
        token: str,
        password: str,
        current_password: str | None = None,
    ) -> IssuedSession:
        if not 15 <= len(password) <= 128:
            raise AccessError("Use a password of 15–128 characters.", 422)
        with self.store.locked():
            state = self.store.read()
            if state is None:
                raise AccessError("Sign in again before changing owner access.")
            now = self.now()
            self.prune(state, now)
            record = self.session_record(state, token)
            if not record:
                raise AccessError("Sign in again before changing owner access.")
            if record.created_at + RECENT_AUTH <= now:
                if len(state.failures) >= LOGIN_FAILURES:
                    raise AccessError("Too many sign-in attempts. Try again in one minute.", 429)
                try:
                    if not state.password_hash or not current_password:
                        self.failed(state, now)
                    HASHER.verify(state.password_hash, current_password)
                except VerificationError:
                    self.failed(state, now)
            state.password_hash = HASHER.hash(password)
            state.sessions = {}
            state.grants = {}
            return self.new_session(state, now)

    def revoke(self, token: str | None = None, *, all_sessions: bool = False) -> None:
        with self.store.locked():
            state = self.store.read()
            if state:
                if all_sessions:
                    state.sessions = {}
                    state.grants = {}
                elif token:
                    state.sessions.pop(digest(token), None)
                self.store.write(state)
