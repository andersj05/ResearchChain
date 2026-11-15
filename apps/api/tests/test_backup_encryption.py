"""Portable age packages use synthetic keys/data; restore targets are disposable."""

import hashlib
import io
import json
import os
import tarfile
import warnings
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import pyrage
import pytest
from psycopg.conninfo import make_conninfo
from pyrage import x25519

from researchchain.artifacts import put_artifact, read_content
from researchchain.backup import create_backup, main
from researchchain.backup_bundle import (
    ENCRYPTED,
    RECEIPT,
    inspect_payload,
    seal_backup,
    unseal_backup,
)
from researchchain.backup_crypto import (
    KEY_FILE,
    MAX_HEADER,
    RECIPIENT_FILE,
    create_recovery_key,
    decrypt_stream,
    encrypt_stream,
    read_identity,
)
from researchchain.backup_files import ARCHIVE, MANIFEST, private_directory
from researchchain.backup_models import BackupError, BackupInventory, BackupManifest
from researchchain.backup_prompt import recovery_passphrase
from researchchain.backup_restore import restore_backup
from researchchain.database import Database
from researchchain.graph import Workflow
from researchchain.models import RunRequest
from researchchain.revisions import RevisionStore
from researchchain.runtime import RunStore

PASSWORD = "synthetic recovery phrase for tests only"


@pytest.fixture(scope="module")
def keys(tmp_path_factory: Any) -> Path:
    directory = tmp_path_factory.mktemp("recovery") / "key"
    create_recovery_key(directory, PASSWORD)
    return directory


def fake_backup(
    directory: Path, data: bytes = b"PGDMP synthetic-private-payload"
) -> BackupManifest:
    private_directory(directory)
    manifest = BackupManifest(
        id=uuid4(),
        created_at=datetime.now(UTC),
        schema_name="private_synthetic",
        postgres_version=180007,
        client_major=18,
        code_dirty=False,
        migrations={"0001_initial.sql": "0" * 64},
        checkpoint_migrations=[0],
        inventory=BackupInventory(
            tables={},
            sequences={},
            structure_hash="0" * 64,
            artifact_count=0,
            artifact_bytes=0,
        ),
        archive_bytes=len(data),
        archive_sha256=hashlib.sha256(data).hexdigest(),
    )
    (directory / ARCHIVE).write_bytes(data)
    (directory / MANIFEST).write_text(manifest.model_dump_json(), encoding="utf-8")
    return manifest


def payload(manifest: BackupManifest, data: bytes, *, mode: str = "") -> bytes:
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w", format=tarfile.GNU_FORMAT) as archive:
        raw = manifest.model_dump_json().encode()
        item = tarfile.TarInfo("../escape" if mode == "path" else MANIFEST)
        item.size = len(raw)
        if mode == "link":
            item.type, item.linkname, item.size = tarfile.SYMTYPE, "../escape", 0
        if mode == "extension":
            item.type = tarfile.XHDTYPE
        if mode == "sparse":
            item.type = tarfile.GNUTYPE_SPARSE
        archive.addfile(item, io.BytesIO(raw))
        item = tarfile.TarInfo(MANIFEST if mode == "duplicate" else ARCHIVE)
        item.size = len(data)
        archive.addfile(item, io.BytesIO(data))
        if mode == "extra":
            item = tarfile.TarInfo("extra")
            item.size = 1
            archive.addfile(item, io.BytesIO(b"x"))
    return output.getvalue()


def test_keys_are_portable_encrypted_and_never_overwritten(keys: Path, tmp_path: Path) -> None:
    protected = (keys / KEY_FILE).read_bytes()
    assert protected.startswith(b"age-encryption.org/v1\n")
    assert b"AGE-SECRET-KEY-" not in protected and PASSWORD.encode() not in protected
    identity = read_identity(keys / KEY_FILE, PASSWORD)
    assert str(identity.to_public()) == (keys / RECIPIENT_FILE).read_text().strip()
    with pytest.raises(BackupError, match="already exists"):
        create_recovery_key(keys, PASSWORD)
    assert (keys / KEY_FILE).read_bytes() == protected
    if os.name != "nt":
        assert (keys / KEY_FILE).stat().st_mode & 0o777 == 0o600
    with pytest.raises(BackupError, match="at least 16"):
        create_recovery_key(tmp_path / "weak", "short")
    assert not (tmp_path / "weak").exists()


def test_standard_age_and_tar_roundtrip(keys: Path, tmp_path: Path) -> None:
    source = tmp_path / "plain"
    content = b"PGDMP" + bytes(range(256)) * 12000
    manifest = fake_backup(source, content)
    sealed = tmp_path / "sealed"
    receipt = seal_backup(source, sealed, keys / RECIPIENT_FILE)
    ciphertext = (sealed / ENCRYPTED).read_bytes()
    assert receipt["ciphertext_sha256"] == hashlib.sha256(ciphertext).hexdigest()
    assert receipt["ciphertext_bytes"] == len(ciphertext)
    assert b"synthetic-private" not in ciphertext and b"private_synthetic" not in ciphertext
    assert sorted(p.name for p in sealed.iterdir()) == sorted([ENCRYPTED, RECEIPT])
    identity = read_identity(keys / KEY_FILE, PASSWORD)
    # An independent standard age call and stdlib tar reader can open the package.
    with tarfile.open(fileobj=io.BytesIO(pyrage.decrypt(ciphertext, [identity]))) as archive:
        assert archive.getnames() == [MANIFEST, ARCHIVE]
        assert archive.extractfile(ARCHIVE).read() == content
    recovered = tmp_path / "recovered"
    result = unseal_backup(sealed / ENCRYPTED, recovered, keys / KEY_FILE, PASSWORD)
    assert result == manifest
    assert (recovered / ARCHIVE).read_bytes() == content
    assert (source / ARCHIVE).read_bytes() == content
    assert sorted(p.name for p in recovered.iterdir()) == sorted([ARCHIVE, MANIFEST])


def test_wrong_passphrase_creates_no_output(keys: Path, tmp_path: Path) -> None:
    with pytest.raises(BackupError, match="unlock"):
        unseal_backup(tmp_path / "unused.age", tmp_path / "output", keys / KEY_FILE, "wrong")
    assert not (tmp_path / "output").exists()


def test_wrong_identity_leaves_no_plaintext(keys: Path, tmp_path: Path) -> None:
    plain = tmp_path / "plain"
    fake_backup(plain)
    other = tmp_path / "other"
    create_recovery_key(other, PASSWORD)
    seal_backup(plain, tmp_path / "sealed", other / RECIPIENT_FILE)
    with pytest.raises(BackupError, match="authentication"):
        unseal_backup(
            tmp_path / "sealed" / ENCRYPTED, tmp_path / "output", keys / KEY_FILE, PASSWORD
        )
    assert list((tmp_path / "output").iterdir()) == []


@pytest.mark.parametrize("damage", ["header", "middle", "truncate", "append"])
def test_damaged_ciphertext_never_publishes_plaintext(
    keys: Path, tmp_path: Path, damage: str
) -> None:
    plain, sealed = tmp_path / "plain", tmp_path / "sealed"
    fake_backup(plain, b"PGDMP" + b"synthetic-private-payload" * 6000)
    seal_backup(plain, sealed, keys / RECIPIENT_FILE)
    data = bytearray((sealed / ENCRYPTED).read_bytes())
    if damage == "header":
        data[0] ^= 1
    elif damage == "middle":
        data[len(data) // 2] ^= 1
    elif damage == "truncate":
        data = data[:-16]
    else:
        data.extend(b"extra")
    damaged = tmp_path / "damaged.age"
    damaged.write_bytes(data)
    with pytest.raises(BackupError):
        unseal_backup(damaged, tmp_path / "output", keys / KEY_FILE, PASSWORD)
    assert list((tmp_path / "output").iterdir()) == []


@pytest.mark.parametrize("mode", ["path", "link", "extension", "sparse", "duplicate", "extra"])
def test_authenticated_malicious_tar_is_not_extracted(
    keys: Path, tmp_path: Path, mode: str
) -> None:
    content = b"PGDMP synthetic"
    manifest = fake_backup(tmp_path / "source", content)
    identity = read_identity(keys / KEY_FILE, PASSWORD)
    encrypted = tmp_path / "malicious.age"
    encrypted.write_bytes(
        pyrage.encrypt(payload(manifest, content, mode=mode), [identity.to_public()])
    )
    sentinel = tmp_path / "escape"
    sentinel.write_bytes(b"keep")
    with pytest.raises(BackupError):
        unseal_backup(encrypted, tmp_path / "output", keys / KEY_FILE, PASSWORD)
    assert sentinel.read_bytes() == b"keep"
    assert list((tmp_path / "output").iterdir()) == []


def test_invalid_manifest_checksum_and_end_markers(tmp_path: Path) -> None:
    content = b"PGDMP synthetic"
    manifest = fake_backup(tmp_path / "source", content)
    with pytest.raises(BackupError, match="checksum"):
        inspect_payload(io.BytesIO(payload(manifest, b"PGDMP corrupted")))
    data = payload(manifest, content)
    with pytest.raises(BackupError):
        inspect_payload(io.BytesIO(data[:1024]))
    with pytest.raises(BackupError, match="end markers"):
        inspect_payload(io.BytesIO(data + b"unexpected"))
    header = tarfile.TarInfo(MANIFEST)
    header.size = 1024 * 1024 + 1
    with pytest.raises(BackupError, match="size limit"):
        inspect_payload(io.BytesIO(header.tobuf()))


def test_input_changed_during_sealing_is_rejected(
    keys: Path, tmp_path: Path, monkeypatch: Any
) -> None:
    source, output = tmp_path / "source", tmp_path / "output"
    original = b"PGDMP original"
    fake_backup(source, original)
    add = tarfile.TarFile.addfile

    def change(self: Any, item: Any, fileobj: Any = None) -> None:
        if item.name == ARCHIVE:
            (source / ARCHIVE).write_bytes(b"PGDMP modified")
        add(self, item, fileobj)

    monkeypatch.setattr(tarfile.TarFile, "addfile", change)
    with pytest.raises(BackupError, match="checksum"):
        seal_backup(source, output, keys / RECIPIENT_FILE)
    assert list(output.iterdir()) == []


def test_no_overwrite_and_partial_output_cleanup(
    keys: Path, tmp_path: Path, monkeypatch: Any
) -> None:
    source, output = tmp_path / "source", tmp_path / "output"
    fake_backup(source)
    output.mkdir()
    sentinel = output / "keep"
    sentinel.write_bytes(b"keep")
    with pytest.raises(BackupError, match="already exists"):
        seal_backup(source, output, keys / RECIPIENT_FILE)
    assert sentinel.read_bytes() == b"keep"

    def fail(source: Any, target: Any, recipient: Any) -> None:
        target.write(b"partial")
        raise BackupError("Synthetic interrupted encryption.")

    monkeypatch.setattr("researchchain.backup_bundle.encrypt_stream", fail)
    failed = tmp_path / "failed"
    with pytest.raises(BackupError):
        seal_backup(source, failed, keys / RECIPIENT_FILE)
    assert list(failed.iterdir()) == []
    assert (source / MANIFEST).exists()


def test_native_final_write_failures_are_not_silent(capsys: Any) -> None:
    identity = x25519.Identity.generate()

    class Failing(io.BytesIO):
        def write(self, data: Any) -> int:
            raise OSError("PRIVATE-SENTINEL")

    with pytest.raises(BackupError) as error:
        encrypt_stream(io.BytesIO(b"small final buffer"), Failing(), identity.to_public())
    assert "PRIVATE-SENTINEL" not in str(error.value)
    assert "PRIVATE-SENTINEL" not in capsys.readouterr().err


def test_streaming_reads_are_bounded_and_headers_fail_early() -> None:
    identity = x25519.Identity.generate()

    class Bounded(io.BytesIO):
        def read(self, count: int = -1) -> bytes:
            assert 0 <= count <= 1024 * 1024
            return super().read(count)

    content = b"synthetic" * 500000
    encrypted = io.BytesIO()
    encrypt_stream(Bounded(content), encrypted, identity.to_public())
    restored = io.BytesIO()
    decrypt_stream(Bounded(encrypted.getvalue()), restored, identity)
    assert restored.getvalue() == content
    oversized = b"age-encryption.org/v1\n-> X25519 " + b"a" * MAX_HEADER
    with pytest.raises(BackupError, match="header"):
        decrypt_stream(Bounded(oversized), io.BytesIO(), identity)


def test_cli_hidden_prompt_and_redaction(tmp_path: Path, monkeypatch: Any, capsys: Any) -> None:
    monkeypatch.setattr("researchchain.backup_prompt.sys.stdin.isatty", lambda: False)
    assert main(["keygen", "--output", str(tmp_path / "key")]) == 1
    assert not (tmp_path / "key").exists()
    assert "local terminal" in capsys.readouterr().err
    monkeypatch.setattr("researchchain.backup_prompt.sys.stdin.isatty", lambda: True)
    values = iter([PASSWORD, "different synthetic password"])
    monkeypatch.setattr("researchchain.backup_prompt.getpass.getpass", lambda *args: next(values))
    with pytest.raises(BackupError, match="did not match"):
        recovery_passphrase(confirm=True)

    def fallback(*args: Any) -> str:
        import getpass

        warnings.warn("PRIVATE-SENTINEL", getpass.GetPassWarning, stacklevel=2)
        raise AssertionError("Echo fallback must never run")

    monkeypatch.setattr("researchchain.backup_prompt.getpass.getpass", fallback)
    with pytest.raises(BackupError, match="unavailable"):
        recovery_passphrase()
    assert "PRIVATE-SENTINEL" not in capsys.readouterr().err


def test_cli_seal_does_not_need_database(
    keys: Path, tmp_path: Path, monkeypatch: Any, capsys: Any
) -> None:
    source = tmp_path / "source"
    fake_backup(source)

    def forbidden() -> Any:
        raise AssertionError("File encryption must not connect to a database")

    monkeypatch.setattr(Database, "from_env", forbidden)
    assert (
        main(
            [
                "seal",
                "--input",
                str(source),
                "--output",
                str(tmp_path / "sealed"),
                "--recipient",
                str(keys / RECIPIENT_FILE),
            ]
        )
        == 0
    )
    receipt = json.loads(capsys.readouterr().out)
    assert receipt["provider_calls"] == 0
    assert "AGE-SECRET-KEY-" not in json.dumps(receipt)


def test_encrypted_backup_restores_real_database(
    database: Database,
    restore_target: str,
    workflow: dict,
    keys: Path,
    tmp_path: Path,
) -> None:
    revision = RevisionStore(database).save(Workflow.model_validate(workflow))
    paused = RunStore(database).start(
        RunRequest(id=uuid4(), revision_id=revision.id, brief="Synthetic encrypted recovery")
    )
    original = bytes(range(256)) * 1024 + b"\x00\xff"
    with database.connection() as conn:
        artifact = put_artifact(conn, original, "synthetic-encrypted-original.bin")
    source = tmp_path / "backup"
    manifest = create_backup(database, source)
    seal_backup(source, tmp_path / "sealed", keys / RECIPIENT_FILE)
    recovered = tmp_path / "recovered"
    assert (
        unseal_backup(tmp_path / "sealed" / ENCRYPTED, recovered, keys / KEY_FILE, PASSWORD)
        == manifest
    )
    with pytest.raises(BackupError, match="trust"):
        restore_backup(database, recovered, restore_target, trusted=False)
    receipt = restore_backup(database, recovered, restore_target, trusted=True)
    restored = Database(make_conninfo(database.url, dbname=restore_target), database.schema)
    assert receipt.provider_calls == 0
    assert RunStore(restored).get(paused.id) == paused
    with restored.connection() as conn:
        assert read_content(conn, artifact.id) == original
    assert RunStore(database).get(paused.id) == paused


def test_output_collision_is_never_deleted_or_overwritten(
    keys: Path, tmp_path: Path, monkeypatch: Any
) -> None:
    from researchchain.backup_bundle import build_payload

    source, output = tmp_path / "source", tmp_path / "output"
    fake_backup(source)

    def collide(directory: Any, payload: Any) -> Any:
        manifest = build_payload(directory, payload)
        (output / ENCRYPTED).write_bytes(b"unrelated-owner-file")
        return manifest

    monkeypatch.setattr("researchchain.backup_bundle.build_payload", collide)
    with pytest.raises(FileExistsError):
        seal_backup(source, output, keys / RECIPIENT_FILE)
    assert (output / ENCRYPTED).read_bytes() == b"unrelated-owner-file"
    assert sorted(p.name for p in output.iterdir()) == [ENCRYPTED]


def test_interrupt_cleans_owned_staging_and_keeps_source(
    keys: Path, tmp_path: Path, monkeypatch: Any
) -> None:
    source, output = tmp_path / "source", tmp_path / "output"
    fake_backup(source)

    def interrupt(source: Any, destination: Any, recipient: Any) -> None:
        destination.write(b"partial")
        raise KeyboardInterrupt

    monkeypatch.setattr("researchchain.backup_bundle.encrypt_stream", interrupt)
    with pytest.raises(KeyboardInterrupt):
        seal_backup(source, output, keys / RECIPIENT_FILE)
    assert list(output.iterdir()) == []
    assert (source / ARCHIVE).read_bytes() == b"PGDMP synthetic-private-payload"
