"""Read recovery secrets only from an explicitly interactive hidden prompt."""

import getpass
import secrets
import sys
import warnings

from researchchain.backup_crypto import validate_passphrase
from researchchain.backup_models import BackupError


def recovery_passphrase(*, confirm: bool = False) -> str:
    if not sys.stdin.isatty():
        raise BackupError("Run this command in a local terminal with hidden passphrase input.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            value = getpass.getpass("Recovery passphrase (hidden): ")
            if confirm:
                validate_passphrase(value)
                repeated = getpass.getpass("Confirm recovery passphrase (hidden): ")
                if not secrets.compare_digest(value.encode("utf-8"), repeated.encode("utf-8")):
                    raise BackupError("Recovery passphrases did not match.")
            return value
    except (getpass.GetPassWarning, EOFError):
        raise BackupError("Hidden passphrase input is unavailable; nothing was created.") from None
