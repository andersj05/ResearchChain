"""Content-free operational snapshots for the current owner workspace."""

from datetime import datetime

from pydantic import Field

from researchchain.graph import StrictModel


class WorkerOperations(StrictModel):
    connected_consumers: int = Field(ge=0)
    max_parallel: int = Field(ge=1, le=8)
    max_pending: int = Field(ge=1, le=1000)
    reserved_slots: int = Field(ge=0)


class QueueOperations(StrictModel):
    queued: int = Field(ge=0)
    executing: int = Field(ge=0)
    awaiting_takeover: int = Field(ge=0)
    interrupted: int = Field(ge=0)
    finished_24h: int = Field(ge=0)
    oldest_pending_seconds: float | None = Field(default=None, ge=0)


class StorageOperations(StrictModel):
    runs: int = Field(ge=0)
    evidence_records: int = Field(ge=0)
    report_revisions: int = Field(ge=0)
    evaluation_datasets: int = Field(ge=0)
    originals: int = Field(ge=0)
    original_bytes: int = Field(ge=0)
    schema_bytes: int = Field(ge=0)


class UsageOperations(StrictModel):
    attempts_started_24h: int = Field(ge=0)
    reported_input_tokens_24h: int = Field(ge=0)
    reported_output_tokens_24h: int = Field(ge=0)
    incomplete_usage_24h: int = Field(ge=0)
    uncertain_attempts: int = Field(ge=0)


class OperationsSnapshot(StrictModel):
    observed_at: datetime
    window_started_at: datetime
    workers: WorkerOperations
    queue: QueueOperations
    storage: StorageOperations
    usage: UsageOperations
