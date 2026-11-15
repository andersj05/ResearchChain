"""Private immutable monitor profiles and atomic state, independent of Postgres."""

import importlib
import os
import stat
import sys
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import TypeVar

import portalocker

from researchchain.backup_crypto import check_path, new_private_directory, private_file
from researchchain.graph import StrictModel
from researchchain.monitor_models import MonitorError, MonitorSettings, MonitorState
from researchchain.providers.credentials import protect, unprotect

MAX_STATE = 64 * 1024
Model = TypeVar("Model", bound=StrictModel)


class MonitorStore:
    def __init__(self, directory: Path):
        self.directory = directory.absolute()
        suffix = "dpapi" if os.name == "nt" else "json"
        self.profile_path = self.directory / f"profile.{suffix}"
        self.state_path = self.directory / f"state.{suffix}"

    def _check(self, path: Path, *, directory: bool = False) -> None:
        check_path(path)
        info = path.stat()
        if (directory and not stat.S_ISDIR(info.st_mode)) or (
            not directory and not stat.S_ISREG(info.st_mode)
        ):
            raise ValueError
        if sys.platform != "win32" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
            raise ValueError

    @contextmanager
    def locked(self) -> Iterator[None]:
        try:
            self._check(self.directory, directory=True)
            lock_path = self.directory / "monitor.lock"
            check_path(lock_path)
            if lock_path.exists():
                self._check(lock_path)
            with portalocker.Lock(str(lock_path), timeout=3):
                if sys.platform != "win32":
                    lock_path.chmod(0o600)
                yield
        except MonitorError:
            raise
        except Exception:
            raise MonitorError(
                "Monitor storage is unavailable or busy. Its files were preserved."
            ) from None

    def _read(self, path: Path, model: type[Model]) -> Model:
        try:
            self._check(self.directory, directory=True)
            self._check(path)
            with path.open("rb") as source:
                encrypted = source.read(2 * MAX_STATE + 1)
            if len(encrypted) > 2 * MAX_STATE:
                raise ValueError
            raw = unprotect(encrypted)
            if len(raw) > MAX_STATE:
                raise ValueError
            return model.model_validate_json(raw)
        except Exception:
            raise MonitorError(
                "Cannot read the protected monitor profile/state. Its files were preserved."
            ) from None

    def read(self) -> tuple[MonitorSettings, MonitorState]:
        settings = self._read(self.profile_path, MonitorSettings)
        state = self._read(self.state_path, MonitorState)
        if settings.id != state.monitor_id:
            raise MonitorError("The monitor profile and state do not match.")
        return settings, state

    def create(self, settings: MonitorSettings) -> None:
        owned: set[Path] = set()
        created = False
        try:
            new_private_directory(self.directory)
            state = MonitorState(monitor_id=settings.id)
            for path, model in ((self.state_path, state), (self.profile_path, settings)):
                raw = model.model_dump_json(context={"monitor_store": True}).encode()
                with private_file(path, owned=owned) as output:
                    output.write(protect(raw))
            created = True
        except Exception:
            raise MonitorError("Could not create a new private monitor profile.") from None
        finally:
            if not created:
                for path in owned:
                    path.unlink(missing_ok=True)

    def write(self, state: MonitorState) -> None:
        """Caller holds the separate lock across sampling, send and acknowledgement."""
        temporary: str | None = None
        try:
            self._check(self.directory, directory=True)
            self._check(self.state_path)
            if self._read(self.profile_path, MonitorSettings).id != state.monitor_id:
                raise ValueError
            raw = state.model_dump_json().encode()
            if len(raw) > MAX_STATE:
                raise ValueError
            descriptor, temporary = tempfile.mkstemp(prefix=".monitor-", dir=self.directory)
            with os.fdopen(descriptor, "wb") as output:
                if sys.platform != "win32":
                    os.fchmod(output.fileno(), 0o600)
                output.write(protect(raw))
                output.flush()
                os.fsync(output.fileno())
            if os.name == "nt":
                files = importlib.import_module("win32file")
                files.MoveFileEx(
                    temporary,
                    str(self.state_path),
                    files.MOVEFILE_REPLACE_EXISTING | files.MOVEFILE_WRITE_THROUGH,
                )
            else:
                os.replace(temporary, self.state_path)
                descriptor = os.open(self.directory, os.O_RDONLY)
                try:
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
            temporary = None
        except Exception:
            raise MonitorError(
                "Could not save monitor state; delivery was not confirmed."
            ) from None
        finally:
            if temporary:
                Path(temporary).unlink(missing_ok=True)
