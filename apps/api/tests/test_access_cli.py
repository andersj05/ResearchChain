"""Operator setup prints no credential; tests use only temporary synthetic state."""

import os
from pathlib import Path

import pytest

import researchchain.access as command
from researchchain.access_config import AccessConfig
from researchchain.access_service import AccessService


@pytest.fixture
def access(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> AccessService:
    config = AccessConfig("c" * 64, tmp_path / "access")
    monkeypatch.setattr(command.AccessConfig, "from_env", lambda _: config)
    return AccessService(config)


def test_login_opens_private_link_without_printing_it(
    access: AccessService, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    opened = []
    monkeypatch.setattr(command.webbrowser, "open", lambda url, new: opened.append(url) or True)
    assert command.main(["login", "--owner-name", "Synthetic owner"]) == 0
    output = capsys.readouterr()
    assert len(opened) == 1 and opened[0].startswith(access.config.origin + "/#owner-link=")
    code = opened[0].split("#owner-link=")[1]
    assert code not in output.out and code not in output.err
    issued = access.exchange(code)
    assert issued.status.session.owner_name == "Synthetic owner"
    assert command.main(["status"]) == 0
    assert "Active sessions: 1" in capsys.readouterr().out
    assert command.main(["revoke"]) == 0
    assert not access.status(issued.token.get_secret_value()).authenticated


def test_written_link_is_private_and_existing_destinations_are_preserved(
    access: AccessService, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    destination = tmp_path / "private-link"
    assert command.main(["login", "--write-link", str(destination)]) == 0
    path = destination / "sign-in.html"
    original = path.read_bytes()
    assert b"#owner-link=" in original
    assert "#owner-link=" not in capsys.readouterr().out
    if os.name != "nt":
        assert path.stat().st_mode & 0o077 == 0
        assert destination.stat().st_mode & 0o077 == 0
    assert command.main(["login", "--write-link", str(destination)]) == 1
    assert path.read_bytes() == original
    assert "#owner-link=" not in capsys.readouterr().err


def test_failed_browser_launch_reports_recovery_without_revealing_url(
    access: AccessService, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(command.webbrowser, "open", lambda url, new: False)
    assert command.main(["login"]) == 1
    output = capsys.readouterr()
    assert "--write-link" in output.err
    assert "#owner-link=" not in output.err + output.out
