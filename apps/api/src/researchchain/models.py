"""Authoritative, versioned API models. Generate browser types from OpenAPI."""

from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, Field, model_validator

from researchchain.code_models import CodeExecution
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
    agent_id: UUID | None = None
    id: UUID
    revision_id: UUID
    baseline_run_id: UUID | None = None
    brief: str = Field(min_length=1, max_length=10000)
    artifacts: list[ArtifactRef] = Field(default_factory=list, max_length=100)
    evidence_ids: list[UUID] = Field(default_factory=list, max_length=100)
    provider_account_id: str | None = Field(default=None, pattern=r"^oaiapp_[a-zA-Z0-9_-]{1,180}$")

    @model_validator(mode="after")
    def validate_inputs(self) -> Self:
        if self.baseline_run_id == self.id:
            raise ValueError("A run cannot be its own baseline.")
        if len(set(self.evidence_ids)) != len(self.evidence_ids):
            raise ValueError("Select each evidence record only once.")
        return self


class ResumeRequest(StrictModel):
    checkpoint_id: str = Field(min_length=1, max_length=100)
    interrupt_id: str = Field(min_length=1, max_length=100)
    decision: Literal["approve", "reject"]
    feedback: str = Field(default="", max_length=6000, pattern=r"^[^\x00]*$")


class ReviewResponse(StrictModel):
    decision: Literal["approve", "reject"]
    feedback: str = ""


class RunEvent(StrictModel):
    node_id: str
    path: str | None = None
    label: str
    kind: NodeKind
    detail: str
    code: CodeExecution | None = None
    review_response: ReviewResponse | None = None


class ReviewPrompt(StrictModel):
    interrupt_id: str
    path: str | None = None
    node_id: str
    question: str


class PendingReviewRun(StrictModel):
    id: UUID
    agent_name: str | None
    workflow_name: str
    created_at: datetime
    checkpoint_id: str
    reviews: list[ReviewPrompt]


class PendingReviewsPage(StrictModel):
    items: list[PendingReviewRun]
    has_more: bool


RunStatus = Literal[
    "queued",
    "paused",
    "completed",
    "rejected",
    "interrupted",
    "cancelled",
    "limited",
    "running",
    "failed",
]


class RunSummary(StrictModel):
    agent_id: UUID | None = None
    agent_name: str | None = None
    id: UUID
    revision_id: UUID
    revision_number: int
    workflow_name: str
    status: RunStatus
    created_at: datetime


class RecentRunSummary(RunSummary):
    brief_excerpt: str


class RunArchiveQuery(StrictModel):
    limit: int = Field(default=20, ge=1, le=50)
    search: str = Field(default="", max_length=200, pattern=r"^[^\x00]*$")
    status: RunStatus | None = None
    agent_id: UUID | None = None
    unassigned: bool = False
    exclude_id: UUID | None = None
    before_created_at: AwareDatetime | None = None
    before_id: UUID | None = None

    @model_validator(mode="after")
    def validate_scope_and_cursor(self) -> Self:
        if self.agent_id is not None and self.unassigned:
            raise ValueError("Choose an agent or unassigned runs.")
        if (self.before_created_at is None) != (self.before_id is None):
            raise ValueError("Provide both the creation time and ID to fetch the next page.")
        return self


class RunArchiveItem(StrictModel):
    run: RunSummary
    brief_excerpt: str


class RunArchivePage(StrictModel):
    items: list[RunArchiveItem]
    has_more: bool


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


class CheckpointStep(StrictModel):
    path: str
    status: Literal["scheduled", "stopped"]


class RunSnapshot(RunSummary):
    execution_pending: bool = Field(
        default=False, description="An accepted command is still queued or held by a worker."
    )
    workflow: Workflow
    brief: str
    baseline_run_id: UUID | None = Field(default=None, exclude_if=lambda value: value is None)
    artifacts: list[ArtifactRef]
    evidence_ids: list[UUID] = Field(default_factory=list)
    compiler_version: str
    checkpoint_id: str | None
    checkpoint_steps: list[CheckpointStep] = Field(default_factory=list)
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
