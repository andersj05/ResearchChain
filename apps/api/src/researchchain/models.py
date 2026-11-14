"""Authoritative, versioned API models. Generate browser types from OpenAPI."""

from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Position(StrictModel):
    x: float = Field(ge=-10000, le=10000, allow_inf_nan=False)
    y: float = Field(ge=-10000, le=10000, allow_inf_nan=False)


class WorkflowNode(StrictModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")
    kind: Literal["note", "review", "finish"]
    label: str = Field(min_length=1, max_length=100)
    instructions: str = Field(default="", max_length=6000)
    position: Position


class WorkflowEdge(StrictModel):
    source: str
    target: str


class Workflow(StrictModel):
    schema_version: Literal["0.1"] = "0.1"
    name: str = Field(min_length=1, max_length=120)
    start_node: str
    nodes: list[WorkflowNode] = Field(min_length=1, max_length=32)
    edges: list[WorkflowEdge] = Field(max_length=31)

    @model_validator(mode="after")
    def validate_topology(self) -> Self:
        ids = {node.id for node in self.nodes}
        if len(ids) != len(self.nodes):
            raise ValueError("Node IDs must be unique.")
        if self.start_node not in ids:
            raise ValueError("Start node must exist.")
        outgoing: dict[str, list[str]] = {node_id: [] for node_id in ids}
        incoming: dict[str, int] = dict.fromkeys(ids, 0)
        pairs: set[tuple[str, str]] = set()
        for edge in self.edges:
            if edge.source not in ids or edge.target not in ids:
                raise ValueError("Every connection must reference existing nodes.")
            pair = (edge.source, edge.target)
            if pair in pairs or edge.source == edge.target:
                raise ValueError("Duplicate connections and self-loops are not supported.")
            pairs.add(pair)
            outgoing[edge.source].append(edge.target)
            incoming[edge.target] += 1
        finishes = [node for node in self.nodes if node.kind == "finish"]
        if len(finishes) != 1:
            raise ValueError("A workflow must contain exactly one finish node.")
        for node in self.nodes:
            expected_out = 0 if node.kind == "finish" else 1
            expected_in = 0 if node.id == self.start_node else 1
            if len(outgoing[node.id]) != expected_out or incoming[node.id] != expected_in:
                raise ValueError(
                    "Version 0.1 supports one connected chain ending at finish. "
                    "Branches, joins, and loops require a future schema version."
                )
        visited: set[str] = set()
        current = self.start_node
        while current not in visited:
            visited.add(current)
            if not outgoing[current]:
                break
            current = outgoing[current][0]
        if visited != ids or current != finishes[0].id:
            raise ValueError("Every node must be reachable and the workflow must terminate.")
        return self


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
    kind: Literal["note", "review", "finish"]
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
