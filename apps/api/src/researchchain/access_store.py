"""Atomic, protected owner credentials; research backups never contain sessions."""

import importlib
import os
import sys
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import portalocker

from researchchain.access_config import AccessConfig
from researchchain.access_models import AccessError, AccessState
from researchchain.backup_files import private_directory
from researchchain.backup_models import BackupError
from researchchain.backup_tools import ROOT
from researchchain.providers.credentials import protect, unprotect

MAX_STATE = 1024 * 1024


class AccessStore:
    def __init__(self, config: AccessConfig):
        self.config = config
        self.directory = config.directory
        self.path = self.directory / ("owner.dpapi" if os.name == "nt" else "owner.json")

    @contextmanager
    def locked(self) -> Iterator[None]:
        try:
            resolved = self.directory.resolve()
            if resolved.is_relative_to(ROOT):
                parts = resolved.relative_to(ROOT).parts
                if not parts or parts[0] not in {".local", "data", "artifacts"}:
                    raise AccessError("Keep owner access files outside tracked source.", 503)
            self.directory.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if not self.directory.exists():
                try:
                    private_directory(self.directory)
                except BackupError:
                    if not self.directory.is_dir():
                        raise
            if self.directory.is_symlink():
                raise AccessError("The access directory must not be a symbolic link.", 503)
            if sys.platform != "win32":
                info = self.directory.stat()
                if info.st_uid != os.getuid() or info.st_mode & 0o077:
                    raise AccessError("The access directory requires owner-only permissions.", 503)
            with portalocker.Lock(str(self.directory / "owner.lock"), timeout=3):
                yield
        except AccessError:
            raise
        except Exception:
            raise AccessError(
                "Protected workbench access is unavailable. Check its local storage.", 503
            ) from None

    def read(self) -> AccessState | None:
        try:
            if not self.path.exists():
                return None
            if self.path.is_symlink() or self.path.stat().st_size > MAX_STATE * 2:
                raise ValueError
            if sys.platform != "win32":
                info = self.path.stat()
                if info.st_uid != os.getuid() or info.st_mode & 0o077:
                    raise ValueError
            raw = unprotect(self.path.read_bytes())
            if len(raw) > MAX_STATE:
                raise ValueError
            state = AccessState.model_validate_json(raw)
            if state.workspace_id != self.config.workspace_id:
                raise ValueError
            return state
        except Exception:
            raise AccessError(
                "Protected owner access cannot be read; its files were preserved.", 503
            ) from None

    def write(self, state: AccessState) -> None:
        temporary: str | None = None
        try:
            if state.workspace_id != self.config.workspace_id or self.path.is_symlink():
                raise ValueError
            data = protect(state.model_dump_json().encode())
            descriptor, temporary = tempfile.mkstemp(prefix=".owner-", dir=self.directory)
            with os.fdopen(descriptor, "wb") as output:
                if sys.platform != "win32":
                    os.fchmod(output.fileno(), 0o600)
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
            if sys.platform == "win32":
                files = importlib.import_module("win32file")
                constants = files
                files.MoveFileEx(
                    temporary,
                    str(self.path),
                    constants.MOVEFILE_REPLACE_EXISTING | constants.MOVEFILE_WRITE_THROUGH,
                )
            else:
                os.replace(temporary, self.path)
                descriptor = os.open(self.directory, os.O_RDONLY)
                try:
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
            temporary = None
        except Exception:
            raise AccessError("Protected owner access could not be saved.", 503) from None
        finally:
            if temporary:
                Path(temporary).unlink(missing_ok=True)
