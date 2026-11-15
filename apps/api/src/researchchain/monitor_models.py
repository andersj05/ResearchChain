"""Content-free monitor contracts; destinations are secrets, never diagnostics."""

from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Literal, Self
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from pydantic import (
    AwareDatetime,
    Field,
    SecretStr,
    SerializationInfo,
    field_serializer,
    model_validator,
)

from researchchain.access_config import AccessConfig
from researchchain.graph import StrictModel


class MonitorError(RuntimeError):
    """Authored operator-facing errors must contain no raw settings or exceptions."""


class Condition(StrEnum):
    DATABASE_UNAVAILABLE = "database_unavailable"
    WORKBENCH_UNAVAILABLE = "workbench_unavailable"
    WORKERS_MISSING = "workers_missing"
    WORK_OVERDUE = "work_overdue"
    RECOVERY_REQUIRED = "recovery_required"
    UNCERTAIN_OUTCOMES = "uncertain_outcomes"
    OBSERVATION_UNAVAILABLE = "observation_unavailable"


class MonitorSettings(StrictModel):
    version: Literal[1] = 1
    id: UUID = Field(default_factory=uuid4)
    workspace_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    origin: str
    interval_seconds: int = Field(default=60, ge=30, le=3600)
    confirmations: int = Field(default=2, ge=1, le=10)
    minimum_workers: int = Field(default=1, ge=0, le=8)
    pending_seconds: int = Field(default=900, ge=30, le=86400)
    webhook: SecretStr | None = Field(default=None, repr=False)
    bearer: SecretStr | None = Field(default=None, repr=False)

    @field_serializer("webhook", "bearer")
    def serialize_secret(self, value: SecretStr | None, info: SerializationInfo) -> str | None:
        if value is None:
            return None
        if info.context and info.context.get("monitor_store"):
            return value.get_secret_value()
        return "**********"

    @model_validator(mode="after")
    def validate_destination(self) -> Self:
        AccessConfig(self.workspace_id, Path("."), origin=self.origin)
        if self.webhook is None:
            if self.bearer is not None:
                raise ValueError("A bearer token requires a webhook.")
            return self
        value = self.webhook.get_secret_value()
        try:
            parsed = urlsplit(value)
            port = parsed.port
            valid = (
                0 < len(value) <= 4096
                and parsed.scheme == "https"
                and bool(parsed.hostname)
                and parsed.username is None
                and parsed.password is None
                and not parsed.fragment
                and port != 0
                and not any(c.isspace() or ord(c) < 32 or c == "\\" for c in value)
            )
        except ValueError:
            valid = False
        if not valid:
            raise ValueError("Use one HTTPS webhook without embedded credentials or a fragment.")
        if self.bearer is not None:
            token = self.bearer.get_secret_value()
            if not 1 <= len(token) <= 4096 or any(ord(c) < 33 or ord(c) > 126 for c in token):
                raise ValueError("Use a bounded bearer token without whitespace.")
        return self


class Observation(StrictModel):
    observed_at: AwareDatetime
    checks: dict[Condition, bool | None]

    @model_validator(mode="after")
    def all_conditions(self) -> Self:
        if set(self.checks) != set(Condition):
            raise ValueError("Every condition needs an observation or explicit unknown state.")
        return self

    @classmethod
    def unavailable(cls, now: datetime) -> Self:
        checks: dict[Condition, bool | None] = dict.fromkeys(Condition)
        checks[Condition.OBSERVATION_UNAVAILABLE] = True
        return cls(observed_at=now, checks=checks)


class Streak(StrictModel):
    value: bool | None = None
    count: int = Field(default=0, ge=0, le=10)


class AlertEvent(StrictModel):
    version: Literal["researchchain.operational-alert.v1"] = "researchchain.operational-alert.v1"
    id: UUID = Field(default_factory=uuid4)
    monitor_id: UUID
    created_at: AwareDatetime
    observed_at: AwareDatetime
    kind: Literal["problem", "recovered", "test"]
    active: list[Condition] = Field(max_length=len(Condition))

    @model_validator(mode="after")
    def consistent(self) -> Self:
        if self.active != sorted(set(self.active)):
            raise ValueError("Alert conditions must be unique and ordered.")
        if (self.kind == "problem") != bool(self.active):
            raise ValueError("Alert kind must match its active conditions.")
        return self


class MonitorState(StrictModel):
    version: Literal[1] = 1
    monitor_id: UUID
    last_sampled_at: AwareDatetime | None = None
    streaks: dict[Condition, Streak] = Field(
        default_factory=lambda: {code: Streak() for code in Condition}
    )
    confirmed: set[Condition] = Field(default_factory=set, max_length=len(Condition))
    acknowledged: set[Condition] = Field(default_factory=set, max_length=len(Condition))
    pending: AlertEvent | None = None
    last_event: AlertEvent | None = None
    attempts: int = Field(default=0, ge=0, le=1000)
    next_attempt_at: AwareDatetime | None = None
    last_acknowledged_at: AwareDatetime | None = None
    delivery_failed: bool = False

    @model_validator(mode="after")
    def consistent(self) -> Self:
        if set(self.streaks) != set(Condition):
            raise ValueError("Monitor state needs every condition.")
        for event in (self.pending, self.last_event):
            if event is not None and (event.monitor_id != self.monitor_id or event.kind == "test"):
                raise ValueError("Alert identity does not match its monitor.")
        return self
