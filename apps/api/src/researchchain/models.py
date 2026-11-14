"""Authoritative, versioned API models. Generate browser types from OpenAPI."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

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


class RevisionSummary(StrictModel):
    id: UUID
    number: int
    content_hash: str
    created_at: datetime
    name: str


class WorkflowRevision(RevisionSummary):
    workflow: Workflow


class ArtifactRef(StrictModel):
    """Content address only. Upload/availability verification belongs to ingestion."""

    id: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    media_type: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=240)


class RunRequest(StrictModel):
    id: UUID
    revision_id: UUID
    brief: str = Field(min_length=1, max_length=10000)
    artifacts: list[ArtifactRef] = Field(default_factory=list, max_length=100)


class ResumeRequest(StrictModel):
    checkpoint_id: str = Field(min_length=1, max_length=100)
    interrupt_id: str = Field(min_length=1, max_length=100)
    decision: Literal["approve", "reject"]


class RunEvent(StrictModel):
    node_id: str
    label: str
    kind: NodeKind
    detail: str


class ReviewPrompt(StrictModel):
    interrupt_id: str
    node_id: str
    question: str


class RunSummary(StrictModel):
    id: UUID
    revision_id: UUID
    revision_number: int
    workflow_name: str
    status: Literal["paused", "completed", "rejected", "interrupted"]
    created_at: datetime


class RunSnapshot(RunSummary):
    workflow: Workflow
    brief: str
    artifacts: list[ArtifactRef]
    compiler_version: str
    checkpoint_id: str | None
    events: list[RunEvent]
    review: ReviewPrompt | None = None


class ValidationResult(StrictModel):
    valid: Literal[True] = True
    node_count: int
    workflow: Workflow


class Health(StrictModel):
    status: Literal["ok"] = "ok"
    mode: Literal["local-development"] = "local-development"
    database: Literal["ready"] = "ready"
