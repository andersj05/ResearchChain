"""Standard age encryption with private, portable recovery identities."""

import io
import os
import re
import stat
from collections.abc import Buffer, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import BinaryIO, cast

import pyrage
from pyrage import passphrase, x25519

from researchchain.backup_files import private_directory
from researchchain.backup_models import BackupError

KEY_FILE = "identity.age"
RECIPIENT_FILE = "recipient.txt"
MAX_KEY = 16 * 1024
MAX_HEADER = 64 * 1024


def check_path(path: Path) -> Path:
    absolute = path.absolute()
    if any(item.is_symlink() or item.is_junction() for item in (absolute, *absolute.parents)):
        raise BackupError("Recovery paths must not contain symbolic links or junctions.")
    return absolute


def new_private_directory(path: Path) -> Path:
    destination = check_path(path)
    private_directory(destination)
    return destination.resolve(strict=True)


@contextmanager
def private_file(path: Path, *, owned: set[Path] | None = None) -> Iterator[BinaryIO]:
    with path.open("x+b") as output:
        if owned is not None:
            owned.add(path)
        if os.name != "nt":
            path.chmod(0o600)
        yield output
        output.flush()
        os.fsync(output.fileno())


@contextmanager
def regular_file(path: Path) -> Iterator[BinaryIO]:
    path = check_path(path)
    if not stat.S_ISREG(path.stat().st_mode):
        raise BackupError("Recovery input must be a regular file.")
    with path.open("rb") as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            raise BackupError("Recovery input must be a regular file.")
        yield source


def read_small(path: Path, limit: int) -> bytes:
    with regular_file(path) as source:
        data = source.read(limit + 1)
    if len(data) > limit:
        raise BackupError("Recovery key or recipient exceeds its size limit.")
    return data


def validate_passphrase(value: str) -> None:
    if len(value.strip()) < 16 or len(value.encode("utf-8")) > 1024:
        raise BackupError(
            "Use a recovery passphrase of at least 16 characters and at most 1024 bytes."
        )


def create_recovery_key(directory: Path, password: str) -> str:
    validate_passphrase(password)
    identity = x25519.Identity.generate()
    public = str(identity.to_public())
    try:
        protected = passphrase.encrypt((str(identity) + "\n").encode("ascii"), password)
    except Exception:
        raise BackupError("Could not protect the recovery key.") from None
    destination = new_private_directory(directory)
    owned: set[Path] = set()
    try:
        for name, data in (
            (KEY_FILE, protected),
            (RECIPIENT_FILE, (public + "\n").encode("ascii")),
        ):
            path = destination / name
            with private_file(path, owned=owned) as output:
                output.write(data)
    except BaseException:
        for path in owned:
            path.unlink(missing_ok=True)
        raise
    return public


def read_recipient(path: Path) -> x25519.Recipient:
    try:
        value = read_small(path, 1024).decode("ascii").strip()
        return x25519.Recipient.from_str(value)
    except (UnicodeError, pyrage.RecipientError):
        raise BackupError("Use one valid age X25519 recipient from the recovery key.") from None


def read_identity(path: Path, password: str) -> x25519.Identity:
    encrypted = read_small(path, MAX_KEY)
    try:
        secret = passphrase.decrypt(encrypted, password).decode("ascii").strip()
        return x25519.Identity.from_str(secret)
    except (UnicodeError, pyrage.DecryptError, pyrage.IdentityError):
        raise BackupError(
            "Could not unlock the recovery key. Check the key and passphrase."
        ) from None


class CheckedWriter(io.BufferedIOBase):
    """Detect errors even if the native binding's final buffered flush ignores them."""

    def __init__(self, target: BinaryIO):
        self.target = target
        self.failed = False

    def writable(self) -> bool:
        return True

    def write(self, data: Buffer, /) -> int:
        try:
            return self.target.write(bytes(data))
        except (OSError, ValueError):
            self.failed = True
            raise

    def flush(self) -> None:
        if not self.target.closed:
            try:
                self.target.flush()
            except (OSError, ValueError):
                self.failed = True
                raise

    def close(self) -> None:
        try:
            super().close()
        except (OSError, ValueError):
            self.failed = True

    def check(self) -> None:
        self.flush()
        if self.failed:
            raise BackupError("Could not write the encrypted recovery output.")


def encrypt_stream(source: BinaryIO, destination: BinaryIO, recipient: x25519.Recipient) -> None:
    writer = CheckedWriter(destination)
    try:
        pyrage.encrypt_io(cast(io.BufferedIOBase, source), writer, [recipient])
        writer.check()
    except Exception:
        raise BackupError(
            "Could not encrypt the backup. No complete package was published."
        ) from None


def decrypt_stream(source: BinaryIO, destination: BinaryIO, identity: x25519.Identity) -> None:
    # Bound unauthenticated header parsing before handing it to the age library.
    header = source.read(MAX_HEADER + 1)
    if (
        not header.startswith(b"age-encryption.org/v1\n")
        or re.search(rb"\n--- [A-Za-z0-9+/]{43}\n", header[:MAX_HEADER]) is None
    ):
        raise BackupError("The encrypted backup has an invalid or oversized age header.")
    source.seek(0)
    writer = CheckedWriter(destination)
    try:
        pyrage.decrypt_io(cast(io.BufferedIOBase, source), writer, [identity])
        writer.check()
    except Exception:
        raise BackupError("Backup authentication failed or output could not be written.") from None
