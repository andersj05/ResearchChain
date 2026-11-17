"""Private output permissions, bounded input and redacted client failures."""

import importlib
import os
import subprocess
from pathlib import Path
from typing import Any

import pytest

from researchchain.backup import main
from researchchain.backup_files import MAX_MANIFEST, private_directory, read_manifest
from researchchain.backup_models import BackupError
from researchchain.backup_tools import ROOT, PostgreSQLTools, connection_environment, execute
from researchchain.database import Database


def test_backup_directory_is_private_and_refuses_existing(tmp_path: Path) -> None:
    directory = tmp_path / "private"
    private_directory(directory)
    if os.name == "nt":
        security = importlib.import_module("win32security")
        descriptor = security.GetNamedSecurityInfo(
            str(directory),
            security.SE_FILE_OBJECT,
            security.DACL_SECURITY_INFORMATION,
        )
        acl = descriptor.GetSecurityDescriptorDacl()
        assert acl.GetAceCount() == 1
        assert descriptor.GetSecurityDescriptorControl()[0] & security.SE_DACL_PROTECTED
    else:
        assert directory.stat().st_mode & 0o777 == 0o700
    with pytest.raises(BackupError, match="already exists"):
        private_directory(directory)


def test_manifest_is_bounded_and_validation_does_not_echo_input(tmp_path: Path) -> None:
    manifest = tmp_path / "manifest.json"
    manifest.write_bytes(b"x" * (MAX_MANIFEST + 1))
    with pytest.raises(BackupError, match="size limit"):
        read_manifest(tmp_path)
    manifest.write_text('{"password":"PRIVATE-SENTINEL"}', encoding="utf-8")
    with pytest.raises(BackupError) as error:
        read_manifest(tmp_path)
    assert "PRIVATE-SENTINEL" not in str(error.value)


def test_client_environment_keeps_credentials_out_of_arguments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("PGSERVICE", "unexpected-service")
    monkeypatch.setenv("PGOPTIONS", "unexpected-options")
    database = Database("postgresql://user:PRIVATE-SENTINEL@localhost:5433/example")
    environment = connection_environment(database, container=True, application="test-backup")
    assert environment["PGPASSWORD"] == "PRIVATE-SENTINEL"
    assert environment["PGHOST"] == "127.0.0.1" and environment["PGPORT"] == "5432"
    assert "PGSERVICE" not in environment and "PGOPTIONS" not in environment
    command = PostgreSQLTools(18, container="a" * 64).command("pg_dump", [], environment)
    assert "PRIVATE-SENTINEL" not in " ".join(command)
    assert "--env" in command and "PGPASSWORD" in command
    with pytest.raises(BackupError, match="local"):
        connection_environment(
            Database("postgresql://user:secret@remote/example"), container=True, application="test"
        )


@pytest.mark.parametrize("mode", ["failure", "timeout", "warning"])
def test_postgres_diagnostics_are_redacted(
    monkeypatch: pytest.MonkeyPatch,
    mode: str,
) -> None:
    def fail(*args: Any, **kwargs: Any) -> Any:
        if mode == "timeout":
            raise subprocess.TimeoutExpired(["PRIVATE-SENTINEL"], 1, stderr=b"PRIVATE-SENTINEL")
        return subprocess.CompletedProcess(
            [],
            1 if mode == "failure" else 0,
            stdout=b"PRIVATE-SENTINEL",
            stderr=b"PRIVATE-SENTINEL",
        )

    monkeypatch.setattr(subprocess, "run", fail)
    with pytest.raises(BackupError) as error:
        execute(["pg_dump"])
    assert "PRIVATE-SENTINEL" not in str(error.value)


def test_cli_redacts_unexpected_errors(monkeypatch: pytest.MonkeyPatch, capsys: Any) -> None:
    def fail(*args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("PRIVATE-SENTINEL")

    monkeypatch.setattr("researchchain.backup.create_backup", fail)
    assert main(["create", "--output", ".local/unused"]) == 1
    assert "PRIVATE-SENTINEL" not in capsys.readouterr().err


def test_backup_refuses_tracked_checkout_destination() -> None:
    with pytest.raises(BackupError, match="ignored"):
        private_directory(ROOT / "must-not-write-private-backups-here")
    assert not (ROOT / "must-not-write-private-backups-here").exists()
