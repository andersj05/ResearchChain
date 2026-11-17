"""Private backup directories and bounded manifests; publish the manifest last."""

import hashlib
import importlib
import os
from pathlib import Path
from typing import BinaryIO

from pydantic import ValidationError

from researchchain.backup_models import BackupError, BackupManifest
from researchchain.backup_tools import ROOT

ARCHIVE = "database.dump"
MANIFEST = "manifest.json"
MAX_MANIFEST = 1024 * 1024


def private_directory(path: Path) -> None:
    resolved = path.resolve()
    if resolved.is_relative_to(ROOT):
        parts = resolved.relative_to(ROOT).parts
        if not parts or parts[0] not in {".local", "data", "artifacts"}:
            raise BackupError(
                "Use an ignored .local/data/artifacts directory or a location outside the checkout."
            )
    try:
        path.mkdir(mode=0o700, exist_ok=False)
    except FileExistsError:
        raise BackupError(
            "The backup destination already exists; choose a new directory."
        ) from None
    if os.name != "nt":
        path.chmod(0o700)
        return
    # chmod alone does not restrict Windows directory access. Set an inheritable
    # owner-only DACL on this newly created directory before writing private data.
    api = importlib.import_module("win32api")
    security = importlib.import_module("win32security")
    constants = importlib.import_module("win32con")
    token = security.OpenProcessToken(api.GetCurrentProcess(), constants.TOKEN_QUERY)
    try:
        sid = security.GetTokenInformation(token, security.TokenUser)[0]
        acl = security.ACL()
        acl.AddAccessAllowedAceEx(
            security.ACL_REVISION,
            security.OBJECT_INHERIT_ACE | security.CONTAINER_INHERIT_ACE,
            importlib.import_module("ntsecuritycon").FILE_ALL_ACCESS,
            sid,
        )
        security.SetNamedSecurityInfo(
            str(path),
            security.SE_FILE_OBJECT,
            security.DACL_SECURITY_INFORMATION | security.PROTECTED_DACL_SECURITY_INFORMATION,
            None,
            None,
            acl,
            None,
        )
    finally:
        token.Close()


def file_digest(stream: BinaryIO) -> tuple[int, str]:
    stream.seek(0)
    digest = hashlib.sha256()
    size = 0
    while chunk := stream.read(1024 * 1024):
        size += len(chunk)
        digest.update(chunk)
    stream.seek(0)
    return size, digest.hexdigest()


def publish_manifest(directory: Path, manifest: BackupManifest) -> None:
    temporary = directory / "manifest.pending"
    with temporary.open("x", encoding="utf-8", newline="\n") as output:
        if os.name != "nt":
            temporary.chmod(0o600)
        output.write(manifest.model_dump_json(indent=2) + "\n")
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(directory / MANIFEST)


def read_manifest(directory: Path) -> BackupManifest:
    path = directory / MANIFEST
    if directory.is_symlink() or path.is_symlink() or (directory / ARCHIVE).is_symlink():
        raise BackupError("Backup directories and files must not be symbolic links.")
    try:
        with path.open("rb") as source:
            raw = source.read(MAX_MANIFEST + 1)
        if len(raw) > MAX_MANIFEST:
            raise BackupError("The backup manifest exceeds its size limit.")
        return BackupManifest.model_validate_json(raw)
    except (OSError, ValidationError):
        raise BackupError("A complete, valid backup manifest is required.") from None


def verify_archive(stream: BinaryIO, manifest: BackupManifest) -> None:
    if stream.read(5) != b"PGDMP":
        raise BackupError("The backup is not a PostgreSQL custom archive.")
    if file_digest(stream) != (manifest.archive_bytes, manifest.archive_sha256):
        raise BackupError("The backup archive's checksum or size does not match its manifest.")
