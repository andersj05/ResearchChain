"""Durable command receipts and workspace-wide worker limits."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from researchchain.graph import StrictModel


class CommandReceipt(StrictModel):
    command_id: UUID
    run_id: UUID
    kind: Literal["start", "resume", "recover"]
    accepted_at: datetime


class RunRecoveryRequest(StrictModel):
    failed_command_id: UUID | None = None


class QueueLimits(StrictModel):
    max_parallel: int = Field(default=2, ge=1, le=8)
    max_pending: int = Field(default=100, ge=1, le=1000)


class DispatchError(RuntimeError):
    def __init__(self, message: str, status: int = 429) -> None:
        super().__init__(message)
        self.status = status
