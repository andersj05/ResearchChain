"""Logical agent identity separate from immutable, shared workflow documents."""

from datetime import datetime
from uuid import UUID

from pydantic import Field

from researchchain.models import RevisionSummary, StrictModel, Workflow, WorkflowRevision


class AgentCreate(StrictModel):
    id: UUID
    workflow: Workflow


class AgentSave(StrictModel):
    expected_version: int = Field(ge=1)
    workflow: Workflow


class AgentSummary(StrictModel):
    id: UUID
    name: str
    version: int
    revision_id: UUID
    created_at: datetime
    updated_at: datetime


class AgentDetail(StrictModel):
    agent: AgentSummary
    revision: WorkflowRevision


class AgentVersion(StrictModel):
    version: int
    revision: RevisionSummary
