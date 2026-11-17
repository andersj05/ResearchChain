"""Private, atomic per-user storage with cross-process token rotation locking."""

import importlib
import os
import sys
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Literal
from uuid import uuid4

import portalocker
from pydantic import BaseModel, Field, SecretStr, SerializationInfo, field_serializer


class ConnectionError(RuntimeError):
    """A safe user-facing message; never include raw provider or credential objects."""


class TokenSet(BaseModel):
    access_token: SecretStr
    refresh_token: SecretStr
    id_token: SecretStr
    scopes: frozenset[str]
    expires_at: float

    @field_serializer("access_token", "refresh_token", "id_token")
    def serialize_secret(self, value: SecretStr, info: SerializationInfo) -> str:
        if info.context and info.context.get("credential_store"):
            return value.get_secret_value()
        return "**********"


class Account(BaseModel):
    label: str
    issuer: Literal["https://auth.openai.com"] = "https://auth.openai.com"
    subject: str
    client_id: str
    email: str | None = None
    tokens: TokenSet | None = Field(default=None, repr=False)
    welcomed: bool = False


class Credentials(BaseModel):
    version: Literal[1] = 1
    host_id: str = Field(default_factory=lambda: f"urn:uuid:{uuid4()}")
    active_client_id: str | None = None
    pending_client_id: str | None = None
    accounts: dict[str, Account] = Field(default_factory=dict)


def default_directory() -> Path:
    if os.name == "nt":
        root = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local"))
        return root / "ResearchChain" / "auth"
    return Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "researchchain/auth"


def protect(data: bytes) -> bytes:
    if sys.platform != "win32":
        return data
    win32crypt = importlib.import_module("win32crypt")

    # Current-user DPAPI. Never enable CRYPTPROTECT_LOCAL_MACHINE.
    return bytes(win32crypt.CryptProtectData(data, "ResearchChain", None, None, None, 1))


def unprotect(data: bytes) -> bytes:
    if sys.platform != "win32":
        return data
    win32crypt = importlib.import_module("win32crypt")

    return bytes(win32crypt.CryptUnprotectData(data, None, None, None, 1)[1])


class CredentialStore:
    def __init__(self, directory: Path | None = None):
        self.directory = directory or default_directory()
        suffix = "dpapi" if os.name == "nt" else "json"
        self.path = self.directory / f"chatgpt.{suffix}"

    @contextmanager
    def locked(self) -> Iterator[None]:
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.directory.is_symlink():
            raise ConnectionError("The credential directory must not be a symbolic link.")
        if sys.platform != "win32":
            self.directory.chmod(0o700)
        try:
            # Always lock a separate file: the credential file is atomically replaced.
            with portalocker.Lock(str(self.directory / "chatgpt.lock"), timeout=30):
                yield
        except portalocker.exceptions.LockException:
            raise ConnectionError(
                "Another process is updating ChatGPT sign-in. Try again."
            ) from None

    def read(self) -> Credentials:
        """Caller must hold locked() across read/modify/write and network refresh."""
        try:
            if not self.path.exists():
                return Credentials()
            if self.path.is_symlink():
                raise ConnectionError("The credential file must not be a symbolic link.")
            if sys.platform != "win32":
                stat = self.path.stat()
                if stat.st_uid != os.getuid() or stat.st_mode & 0o077:
                    raise ConnectionError(
                        "ChatGPT credentials require owner-only permissions (0600)."
                    )
            return Credentials.model_validate_json(unprotect(self.path.read_bytes()))
        except ConnectionError:
            raise
        except Exception:
            # Validation and DPAPI exceptions can contain sensitive material.
            raise ConnectionError(
                "Cannot read protected ChatGPT credentials. They were preserved."
            ) from None

    def write(self, credentials: Credentials) -> None:
        """Caller holds locked(); persist all rotating credentials in one replacement."""
        temporary: str | None = None
        try:
            data = protect(credentials.model_dump_json(context={"credential_store": True}).encode())
            descriptor, temporary = tempfile.mkstemp(prefix=".chatgpt-", dir=self.directory)
            with os.fdopen(descriptor, "wb") as output:
                if sys.platform != "win32":
                    os.fchmod(output.fileno(), 0o600)
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, self.path)
            temporary = None
        except Exception:
            raise ConnectionError("Could not save protected ChatGPT credentials.") from None
        finally:
            if temporary is not None:
                Path(temporary).unlink(missing_ok=True)
