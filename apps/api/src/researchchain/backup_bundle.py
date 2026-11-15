"""Two-member standard tar payloads, fully authenticated before unpacking."""

import hashlib
import io
import json
import os
import shutil
import tarfile
from datetime import UTC, datetime
from pathlib import Path
from typing import BinaryIO

from pydantic import ValidationError

from researchchain.backup_crypto import (
    check_path,
    decrypt_stream,
    encrypt_stream,
    new_private_directory,
    private_file,
    read_identity,
    read_recipient,
    regular_file,
)
from researchchain.backup_files import (
    ARCHIVE,
    MANIFEST,
    MAX_MANIFEST,
    file_digest,
    publish_manifest,
    read_manifest,
)
from researchchain.backup_models import BackupError, BackupManifest

ENCRYPTED = "backup.tar.age"
RECEIPT = "sealed.json"
CHUNK = 1024 * 1024
BLOCK = 512


def read_exact(source: BinaryIO, count: int) -> bytes:
    value = source.read(count)
    if len(value) != count:
        raise BackupError("The recovery payload is incomplete.")
    return value


def read_header(source: BinaryIO, name: str) -> tarfile.TarInfo:
    try:
        item = tarfile.TarInfo.frombuf(read_exact(source, BLOCK), "utf-8", "strict")
    except (tarfile.TarError, UnicodeError, ValueError):
        raise BackupError("The recovery payload contains an invalid tar header.") from None
    if item.name != name or item.type not in {tarfile.REGTYPE, tarfile.AREGTYPE} or item.linkname:
        raise BackupError("The recovery payload must contain only the two expected regular files.")
    return item


def padding(source: BinaryIO, size: int) -> None:
    if any(read_exact(source, -size % BLOCK)):
        raise BackupError("The recovery payload has invalid file padding.")


def inspect_payload(source: BinaryIO, destination: BinaryIO | None = None) -> BackupManifest:
    """Read fixed ordinary headers directly; never follow tar extensions or paths."""
    source.seek(0, os.SEEK_END)
    length = source.tell()
    source.seek(0)
    header = read_header(source, MANIFEST)
    if not 0 < header.size <= MAX_MANIFEST:
        raise BackupError("The recovery manifest exceeds its size limit.")
    try:
        manifest = BackupManifest.model_validate_json(read_exact(source, header.size))
    except ValidationError:
        raise BackupError("The recovery manifest is invalid.") from None
    padding(source, header.size)
    header = read_header(source, ARCHIVE)
    if header.size != manifest.archive_bytes or header.size > length - source.tell() - 2 * BLOCK:
        raise BackupError("The recovery archive size does not match its manifest.")
    remaining = header.size
    digest = hashlib.sha256()
    first = True
    while remaining:
        data = read_exact(source, min(CHUNK, remaining))
        if first and not data.startswith(b"PGDMP"):
            raise BackupError("The recovery file is not a PostgreSQL custom archive.")
        first = False
        digest.update(data)
        if destination is not None:
            destination.write(data)
        remaining -= len(data)
    if digest.hexdigest() != manifest.archive_sha256:
        raise BackupError("The recovery archive checksum does not match its manifest.")
    padding(source, header.size)
    # Exactly the two files, end markers and bounded zero record padding.
    tail = source.read(2 * tarfile.RECORDSIZE + 1)
    if not 2 * BLOCK <= len(tail) <= 2 * tarfile.RECORDSIZE or any(tail):
        raise BackupError("The recovery payload has extra entries or invalid end markers.")
    source.seek(0)
    return manifest


def build_payload(directory: Path, payload: BinaryIO) -> BackupManifest:
    directory = check_path(directory)
    manifest = read_manifest(directory)
    contents = manifest.model_dump_json().encode("utf-8")
    if len(contents) > MAX_MANIFEST:
        raise BackupError("The backup manifest exceeds its size limit.")
    with regular_file(directory / ARCHIVE) as database:
        if os.fstat(database.fileno()).st_size != manifest.archive_bytes:
            raise BackupError("The backup archive size does not match its manifest.")
        # GNU headers support large ordinary files without PAX extensions.
        with tarfile.open(fileobj=payload, mode="w", format=tarfile.GNU_FORMAT) as archive:
            metadata = tarfile.TarInfo(MANIFEST)
            metadata.size, metadata.mode = len(contents), 0o600
            archive.addfile(metadata, io.BytesIO(contents))
            data = tarfile.TarInfo(ARCHIVE)
            data.size, data.mode = manifest.archive_bytes, 0o600
            archive.addfile(data, database)
    payload.flush()
    # Validate bytes actually captured, even if the input changed during the copy.
    return inspect_payload(payload)


def require_space(directory: Path, size: int) -> None:
    if shutil.disk_usage(directory).free < size + 16 * CHUNK:
        raise BackupError("There is not enough free space for the private recovery staging file.")


def seal_backup(source: Path, output: Path, recipient_file: Path) -> dict[str, object]:
    source = check_path(source)
    recipient = read_recipient(recipient_file)
    # Validate source metadata before creating a destination.
    manifest = read_manifest(source)
    destination = new_private_directory(output)
    payload_path, pending = destination / "payload.pending", destination / "encrypted.pending"
    published = False
    try:
        require_space(destination, 2 * manifest.archive_bytes + MAX_MANIFEST)
        with private_file(payload_path) as payload:
            build_payload(source, payload)
            with private_file(pending) as encrypted:
                encrypt_stream(payload, encrypted, recipient)
                size, digest = file_digest(encrypted)
        pending.rename(destination / ENCRYPTED)
        receipt: dict[str, object] = {
            "format": "researchchain-encrypted-backup-1",
            "created_at": datetime.now(UTC).isoformat(),
            "ciphertext_bytes": size,
            "ciphertext_sha256": digest,
            "recipient": str(recipient),
            "provider_calls": 0,
        }
        with private_file(destination / RECEIPT) as metadata:
            metadata.write((json.dumps(receipt, indent=2) + "\n").encode("utf-8"))
        published = True
        return receipt
    finally:
        payload_path.unlink(missing_ok=True)
        pending.unlink(missing_ok=True)
        if not published:
            (destination / ENCRYPTED).unlink(missing_ok=True)
            (destination / RECEIPT).unlink(missing_ok=True)


def unseal_backup(
    encrypted_file: Path, output: Path, identity_file: Path, password: str
) -> BackupManifest:
    identity = read_identity(identity_file, password)
    with regular_file(encrypted_file) as encrypted:
        destination = new_private_directory(output)
        payload_path = destination / "payload.pending"
        database_path = destination / "database.pending"
        published = False
        try:
            require_space(destination, 2 * os.fstat(encrypted.fileno()).st_size)
            with private_file(payload_path) as payload:
                decrypt_stream(encrypted, payload, identity)
                # Only after full age authentication succeeds may tar data be parsed.
                with private_file(database_path) as database:
                    manifest = inspect_payload(payload, database)
            database_path.rename(destination / ARCHIVE)
            publish_manifest(destination, manifest)
            published = True
            return manifest
        finally:
            payload_path.unlink(missing_ok=True)
            database_path.unlink(missing_ok=True)
            if not published:
                for name in (ARCHIVE, MANIFEST, "manifest.pending"):
                    (destination / name).unlink(missing_ok=True)
