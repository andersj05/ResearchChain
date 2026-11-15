"""Explicit owner cleanup contracts; previews and receipts contain no source text."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from researchchain.graph import StrictModel


class RetentionError(ValueError):
    def __init__(self, message: str, status: int = 409) -> None:
        super().__init__(message)
        self.status = status


class RetentionRequest(StrictModel):
    id: UUID
    older_than_days: int = Field(default=30, ge=0, le=3650)
    max_runs: int = Field(default=5, ge=1, le=10)


class RetentionRun(StrictModel):
    run_id: UUID
    created_at: datetime
    status: str
    fingerprint: str


class RetentionOriginal(StrictModel):
    artifact_id: str
    byte_size: int = Field(ge=0)
    fingerprint: str


class RetentionPreview(StrictModel):
    id: UUID
    created_at: datetime
    expires_at: datetime
    cutoff: datetime
    request: RetentionRequest
    runs: list[RetentionRun]
    originals: list[RetentionOriginal]
    retained_originals: int = Field(ge=0)
    original_bytes: int = Field(ge=0)
    protected_runs: dict[str, int]
    more_eligible: int = Field(ge=0)
    digest: str


class RetentionConfirm(StrictModel):
    digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    confirmation: Literal["DELETE"]


class RetentionReceipt(StrictModel):
    preview_id: UUID
    applied_at: datetime
    run_ids: list[UUID]
    original_ids: list[str]
    deleted_rows: dict[str, int]
    original_bytes: int = Field(ge=0)


class RetentionView(StrictModel):
    preview: RetentionPreview
    receipt: RetentionReceipt | None = None
