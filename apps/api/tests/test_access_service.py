"""Synthetic owner credentials never touch the real protected account directory."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path

import pytest

from researchchain.access_config import AccessConfig
from researchchain.access_models import AccessError
from researchchain.access_service import AccessService, digest
from researchchain.database import Database

PASSWORD = "synthetic owner password for tests"


@pytest.fixture
def clock() -> list[int]:
    return [1_700_000_000]


@pytest.fixture
def access(tmp_path: Path, clock: list[int]) -> AccessService:
    return AccessService(
        AccessConfig("a" * 64, tmp_path / "access", session_seconds=3600, idle_seconds=600),
        clock=lambda: clock[0],
    )


def sign_in(access: AccessService):
    return access.exchange(access.issue_link().get_secret_value())


def test_owner_setup_link_is_single_use_and_tokens_are_not_stored(access: AccessService) -> None:
    assert not access.status(None).authenticated
    code = access.issue_link("Synthetic owner")
    issued = access.exchange(code.get_secret_value())
    token = issued.token.get_secret_value()
    assert issued.status.authenticated and not issued.status.password_enabled
    assert issued.status.session.owner_name == "Synthetic owner"
    assert access.status(token).authenticated
    assert not access.status(code.get_secret_value()).authenticated
    assert token not in repr(issued) and issued.status.session.csrf_token not in repr(issued)
    with access.store.locked():
        state = access.store.read()
        text = state.model_dump_json()
        assert token not in text and code.get_secret_value() not in text
        assert digest(token) in state.sessions and state.grants == {}
    with pytest.raises(AccessError):
        access.exchange(code.get_secret_value())


def test_concurrent_exchange_admits_only_one_session(access: AccessService) -> None:
    code = access.issue_link().get_secret_value()

    def exchange(_: int) -> bool:
        try:
            access.exchange(code)
            return True
        except AccessError:
            return False

    with ThreadPoolExecutor(max_workers=8) as pool:
        assert sum(pool.map(exchange, range(8))) == 1
    with access.store.locked():
        assert len(access.store.read().sessions) == 1


def test_password_signin_rotation_and_logout(access: AccessService) -> None:
    initial = sign_in(access)
    other = sign_in(access)
    configured = access.set_password(initial.token.get_secret_value(), PASSWORD)
    assert configured.status.password_enabled
    assert not access.status(initial.token.get_secret_value()).authenticated
    assert not access.status(other.token.get_secret_value()).authenticated
    assert access.status(configured.token.get_secret_value()).authenticated
    with access.store.locked():
        state = access.store.read()
        assert state.password_hash.startswith("$argon2id$")
        assert PASSWORD not in state.model_dump_json()
    with pytest.raises(AccessError):
        access.login("incorrect password")
    renewed = access.login(PASSWORD, configured.token.get_secret_value())
    assert renewed.token != configured.token
    assert not access.status(configured.token.get_secret_value()).authenticated
    access.revoke(renewed.token.get_secret_value())
    assert not access.status(renewed.token.get_secret_value()).authenticated


def test_idle_absolute_expiry_and_expired_links(
    access: AccessService,
    clock: list[int],
) -> None:
    short = AccessService(
        replace(access.config, idle_seconds=60, session_seconds=120), clock=lambda: clock[0]
    )
    issued = sign_in(short)
    token = issued.token.get_secret_value()
    clock[0] += 59
    assert short.status(token, touch=True).authenticated
    clock[0] += 59
    assert short.status(token, touch=True).authenticated
    clock[0] += 2
    assert not short.status(token).authenticated
    issued = sign_in(short)
    clock[0] += 60
    assert not short.status(issued.token.get_secret_value()).authenticated
    code = short.issue_link()
    clock[0] += short.config.grant_seconds
    with pytest.raises(AccessError):
        short.exchange(code.get_secret_value())


def test_password_change_requires_recent_proof_and_revokes_other_sessions(
    access: AccessService,
    clock: list[int],
) -> None:
    issued = sign_in(access)
    configured = access.set_password(issued.token.get_secret_value(), PASSWORD)
    clock[0] += 301
    with pytest.raises(AccessError):
        access.set_password(configured.token.get_secret_value(), "replacement synthetic password")
    changed = access.set_password(
        configured.token.get_secret_value(),
        "replacement synthetic password",
        PASSWORD,
    )
    assert changed.status.authenticated
    assert not access.status(configured.token.get_secret_value()).authenticated
    with pytest.raises(AccessError):
        access.login(PASSWORD)


def test_failures_are_bounded_shared_and_operator_recovery_still_works(
    access: AccessService,
    clock: list[int],
) -> None:
    initial = sign_in(access)
    access.set_password(initial.token.get_secret_value(), PASSWORD)
    another = AccessService(access.config, clock=lambda: clock[0])
    for _ in range(10):
        with pytest.raises(AccessError):
            another.login("wrong")
    with pytest.raises(AccessError) as error:
        access.login(PASSWORD)
    assert error.value.status == 429
    code = access.issue_link()
    assert access.exchange(code.get_secret_value()).status.authenticated
    access.revoke(all_sessions=True)
    assert access.login(PASSWORD).status.authenticated


def test_sessions_survive_process_objects_but_not_origin_or_workspace_changes(
    access: AccessService,
    tmp_path: Path,
    clock: list[int],
) -> None:
    issued = sign_in(access)
    restored_service = AccessService(access.config, clock=lambda: clock[0])
    assert restored_service.status(issued.token.get_secret_value()).authenticated
    other_origin = AccessService(
        replace(access.config, origin="http://localhost:3000"),
        clock=lambda: clock[0],
    )
    assert not other_origin.status(issued.token.get_secret_value()).authenticated
    other_workspace = AccessService(
        replace(access.config, workspace_id="b" * 64, directory=tmp_path / "other"),
        clock=lambda: clock[0],
    )
    assert not other_workspace.status(issued.token.get_secret_value()).authenticated
    with other_workspace.store.locked():
        other_workspace.store.path.write_bytes(access.store.path.read_bytes())
    with pytest.raises(AccessError) as error:
        other_workspace.status(issued.token.get_secret_value())
    assert error.value.status == 503


def test_scope_excludes_database_password_but_includes_target_and_schema(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("RESEARCHCHAIN_ACCESS_DIRECTORY", str(tmp_path))
    first = AccessConfig.from_env(Database("postgresql://user:one@localhost/db", "first"))
    rotated = AccessConfig.from_env(Database("postgresql://user:two@localhost/db", "first"))
    assert first == rotated
    assert (
        first.workspace_id
        != AccessConfig.from_env(
            Database("postgresql://user:one@localhost/restore", "first")
        ).workspace_id
    )
    assert (
        first.workspace_id
        != AccessConfig.from_env(
            Database("postgresql://user:one@localhost/db", "second")
        ).workspace_id
    )
    with pytest.raises(AccessError, match="HTTPS"):
        replace(first, origin="http://example.com")
    secure = replace(first, origin="https://research.example.com")
    assert secure.secure and secure.cookie_name.startswith("__Host-")


def test_corrupt_access_state_is_preserved_and_errors_are_redacted(access: AccessService) -> None:
    access.issue_link()
    invalid = b"PRIVATE-SENTINEL"
    access.store.path.write_bytes(invalid)
    with pytest.raises(AccessError) as error:
        access.status(None)
    assert "PRIVATE-SENTINEL" not in str(error.value)
    assert access.store.path.read_bytes() == invalid
