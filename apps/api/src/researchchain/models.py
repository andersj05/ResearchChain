"""Authoritative, versioned API models. Generate browser types from OpenAPI."""

from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import Field, model_validator

from researchchain.graph import (
    NodeKind,
)
from researchchain.graph import (
    Position as Position,
)
from researchchain.graph import (
    StrictModel as StrictModel,
)
from researchchain.graph import (
    Workflow as Workflow,
)
from researchchain.graph import (
    WorkflowEdge as WorkflowEdge,
)
from researchchain.graph import (
    WorkflowNode as WorkflowNode,
)
from researchchain.research_models import ModelAttempt, ResearchManifest


class RevisionSummary(StrictModel):
    id: UUID
    number: int
    content_hash: str
    created_at: datetime
    name: str


class WorkflowRevision(RevisionSummary):
    workflow: Workflow


class ArtifactRef(StrictModel):
    """Stable manifest wire shape, also retained by runs created before ingestion."""

    id: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    media_type: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=240)


class RunRequest(StrictModel):
    id: UUID
    revision_id: UUID
    brief: str = Field(min_length=1, max_length=10000)
    artifacts: list[ArtifactRef] = Field(default_factory=list, max_length=100)
    evidence_ids: list[UUID] = Field(default_factory=list, max_length=100)
    provider_account_id: str | None = Field(default=None, pattern=r"^oaiapp_[a-zA-Z0-9_-]{1,180}$")

    @model_validator(mode="after")
    def unique_evidence(self) -> Self:
        if len(set(self.evidence_ids)) != len(self.evidence_ids):
            raise ValueError("Select each evidence record only once.")
        return self


class ResumeRequest(StrictModel):
    checkpoint_id: str = Field(min_length=1, max_length=100)
    interrupt_id: str = Field(min_length=1, max_length=100)
    decision: Literal["approve", "reject"]
    feedback: str = Field(default="", max_length=6000, pattern=r"^[^\x00]*$")


class RunEvent(StrictModel):
    node_id: str
    path: str | None = None
    label: str
    kind: NodeKind
    detail: str


class ReviewPrompt(StrictModel):
    interrupt_id: str
    path: str | None = None
    node_id: str
    question: str


class RunSummary(StrictModel):
    id: UUID
    revision_id: UUID
    revision_number: int
    workflow_name: str
    status: Literal[
        "paused",
        "completed",
        "rejected",
        "interrupted",
        "cancelled",
        "limited",
        "running",
        "failed",
    ]
    created_at: datetime


class RunUsage(StrictModel):
    node_executions: int = 0
    active_seconds: float = 0
    model_calls: int = 0
    tool_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    usage_complete: bool = True


class CancelResult(StrictModel):
    id: UUID
    status: Literal["cancelled", "completed", "rejected", "limited", "failed"]


class RunSnapshot(RunSummary):
    workflow: Workflow
    brief: str
    artifacts: list[ArtifactRef]
    evidence_ids: list[UUID] = Field(default_factory=list)
    compiler_version: str
    checkpoint_id: str | None
    events: list[RunEvent]
    review: ReviewPrompt | None = None
    reviews: list[ReviewPrompt] = Field(default_factory=list)
    stop_reason: str | None = None
    usage: RunUsage = Field(default_factory=RunUsage)
    research_manifest: ResearchManifest | None = None
    model_attempts: list[ModelAttempt] = Field(default_factory=list)


class ValidationResult(StrictModel):
    valid: Literal[True] = True
    node_count: int
    workflow: Workflow


class Health(StrictModel):
    status: Literal["ok"] = "ok"
