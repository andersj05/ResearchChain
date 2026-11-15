"""Bounded backup metadata contains fingerprints, never connection credentials."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field

from researchchain.graph import StrictModel

Identifier = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,62}$")]
Digest = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class BackupError(RuntimeError):
    """Only safe, authored messages may cross the command-line boundary."""


class TableFingerprint(StrictModel):
    rows: int = Field(ge=0)
    sha256: Digest


class SequenceFloor(StrictModel):
    last_value: int = Field(ge=1)
    is_called: bool


class BackupInventory(StrictModel):
    tables: dict[Identifier, TableFingerprint] = Field(max_length=256)
    sequences: dict[Identifier, SequenceFloor] = Field(max_length=128)
    structure_hash: Digest
    artifact_count: int = Field(ge=0)
    artifact_bytes: int = Field(ge=0)


class BackupManifest(StrictModel):
    format: Literal["researchchain-backup-1"] = "researchchain-backup-1"
    id: UUID
    created_at: datetime
    schema_name: Identifier
    postgres_version: int = Field(ge=140000)
    client_major: int = Field(ge=14, le=99)
    code_revision: str | None = Field(default=None, pattern=r"^[a-f0-9]{40}$")
    code_dirty: bool
    migrations: dict[str, Digest] = Field(min_length=1, max_length=500)
    checkpoint_migrations: list[int] = Field(max_length=1000)
    inventory: BackupInventory
    archive_bytes: int = Field(ge=1)
    archive_sha256: Digest
    scope: Literal["single_schema"] = "single_schema"
    includes_provider_credentials: Literal[False] = False


class RestoreReceipt(StrictModel):
    format: Literal["researchchain-restore-1"] = "researchchain-restore-1"
    backup_id: UUID
    target_database: Identifier
    schema_name: Identifier
    archive_sha256: Digest
    verified_at: datetime
    tables: int = Field(ge=1)
    rows: int = Field(ge=0)
    original_count: int = Field(ge=0)
    original_bytes: int = Field(ge=0)
    held_commands: int = Field(default=0, ge=0)
    provider_calls: Literal[0] = 0
