"""Workspace request admission contracts; no provider billing estimate."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from researchchain.graph import StrictModel

RequestSource = Literal["research", "connection_test"]
PolicyActor = Literal["owner", "operator"]


class UsageError(RuntimeError):
    def __init__(self, message: str, status: int = 429):
        super().__init__(message)
        self.status = status


class UsagePolicy(StrictModel):
    revision: int = Field(ge=1, le=9223372036854775807)
    max_requests_24h: int = Field(ge=1, le=10000)
    paused: bool
    changed_by: Literal["initial", "owner", "operator"]
    changed_at: datetime


class UsagePolicyUpdate(StrictModel):
    expected_revision: int = Field(ge=1, le=9223372036854775807, strict=True)
    max_requests_24h: int = Field(ge=1, le=10000, strict=True)
    paused: bool = Field(strict=True)


class UsageSnapshot(StrictModel):
    observed_at: datetime
    window_started_at: datetime
    policy: UsagePolicy
    admitted_requests_24h: int = Field(ge=0)
    remaining_requests: int = Field(ge=0)
    next_slot_at: datetime | None = None


class RequestAdmission(StrictModel):
    id: UUID
    admitted_at: datetime
    source: RequestSource
    policy_revision: int = Field(ge=1)
