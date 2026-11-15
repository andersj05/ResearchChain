"""Public owner-session contracts and private, bounded credential state."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from pydantic import Field, SecretStr

from researchchain.graph import StrictModel

Digest = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class AccessError(RuntimeError):
    def __init__(self, message: str, status: int = 401):
        super().__init__(message)
        self.status = status


class OwnerSession(StrictModel):
    owner_id: UUID
    owner_name: str
    workspace_id: Digest
    csrf_token: str = Field(repr=False)
    expires_at: datetime
    idle_expires_at: datetime
    password_enabled: bool
    recent_authentication: bool


class AccessStatus(StrictModel):
    authenticated: bool
    password_enabled: bool
    session: OwnerSession | None = None


class LinkExchange(StrictModel):
    code: SecretStr = Field(min_length=43, max_length=128)


class PasswordLogin(StrictModel):
    password: SecretStr = Field(min_length=1, max_length=128)


class PasswordChange(StrictModel):
    password: SecretStr = Field(min_length=15, max_length=128)
    current_password: SecretStr | None = Field(default=None, max_length=128)


class SignOutResult(StrictModel):
    signed_out: Literal[True] = True


class AccessGrant(StrictModel):
    origin: str
    created_at: int
    expires_at: int


class SessionRecord(StrictModel):
    origin: str
    created_at: int
    last_seen: int
    expires_at: int
    csrf: str = Field(repr=False)


class AccessState(StrictModel):
    version: Literal[1] = 1
    workspace_id: Digest
    owner_id: UUID = Field(default_factory=uuid4)
    owner_name: str = Field(default="Owner", min_length=1, max_length=100)
    password_hash: str | None = Field(default=None, repr=False, max_length=1024)
    grants: dict[Digest, AccessGrant] = Field(default_factory=dict, max_length=5)
    sessions: dict[Digest, SessionRecord] = Field(default_factory=dict, max_length=16)
    failures: list[int] = Field(default_factory=list, max_length=20)
