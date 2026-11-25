"""Immutable editorial revisions and explicitly human feedback; no training consent."""

from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import Field, StringConstraints, model_validator

from researchchain.evidence_models import EvidenceRecord
from researchchain.research_models import (
    ModelAttempt,
    ResearchCitation,
    ResearchManifest,
    ResearchModel,
)

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=240)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=6000)]
Hash = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
MAX_REPORT_BUNDLE_BYTES = 64 * 1024 * 1024


class StyleExample(ResearchModel):
    kind: Literal["structure", "voice"]
    principle: Note
    example: Note


class StyleGuideCreate(ResearchModel):
    id: UUID
    replaces_id: UUID | None = None
    title: Title
    analytical_structure: Note
    voice: Note
    source_discipline: Note
    scenarios: Note
    examples: list[StyleExample] = Field(min_length=2, max_length=20)
    change_note: Note

    @model_validator(mode="after")
    def distinct_examples(self) -> Self:
        if {item.kind for item in self.examples} != {"structure", "voice"}:
            raise ValueError("Include both analytical-structure and prose-voice examples.")
        if self.replaces_id == self.id:
            raise ValueError("A guide cannot replace itself.")
        return self


class StyleGuide(StyleGuideCreate):
    series_id: UUID
    version: int
    content_hash: Hash
    created_at: datetime
    use_scope: Literal["editorial_development"] = "editorial_development"


class ReportSection(ResearchModel):
    id: UUID
    heading: Title
    body: str = Field(min_length=1, max_length=60000)
    kind: Literal["fact", "interpretation", "scenario"] = "interpretation"
    citations: list[ResearchCitation] = Field(default_factory=list, max_length=40)
    chart_ids: list[UUID] = Field(default_factory=list, max_length=12)

    @model_validator(mode="after")
    def valid_section(self) -> Self:
        if not self.body.strip():
            raise ValueError("A section needs text.")
        if len(set(self.chart_ids)) != len(self.chart_ids):
            raise ValueError("Select each chart once per section.")
        if self.kind == "fact" and not any(
            item.relation == "supports" and item.basis != "metadata_only" for item in self.citations
        ):
            raise ValueError(
                "A fact section needs captured supporting evidence; truth remains a human judgment."
            )
        return self


class ReportCreate(ResearchModel):
    id: UUID
    title: Title
    run_id: UUID
    attempt_id: UUID
    style_guide_id: UUID
    source_format: Literal["session_markdown"] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )


class ReportSave(ResearchModel):
    id: UUID
    base_revision_id: UUID
    title: Title
    style_guide_id: UUID
    evidence_ids: list[UUID] = Field(max_length=100)
    sections: list[ReportSection] = Field(min_length=1, max_length=40)
    change_note: Note

    @model_validator(mode="after")
    def bounded_unique(self) -> Self:
        if self.id == self.base_revision_id:
            raise ValueError("A saved revision needs a new ID.")
        if len({item.id for item in self.sections}) != len(self.sections):
            raise ValueError("Section IDs must be distinct.")
        if len(set(self.evidence_ids)) != len(self.evidence_ids):
            raise ValueError("Select each source only once.")
        if sum(len(item.body) for item in self.sections) > 200000:
            raise ValueError("Reports support at most 200,000 text characters.")
        return self


class ReportProvenance(ResearchModel):
    run_id: UUID
    brief: str
    workflow_hash: str
    manifest: ResearchManifest
    attempt: ModelAttempt
    renderer: Literal["report-seed-1", "study-markdown-1"] = "report-seed-1"
    recorded_urls: list[str] = Field(default_factory=list, exclude_if=lambda value: not value)


class ReportEdit(ResearchModel):
    section_id: UUID
    change: Literal["added", "removed", "edited", "moved"]
    before_hash: Hash | None
    after_hash: Hash | None


class ReportRevision(ResearchModel):
    id: UUID
    series_id: UUID
    version: int
    replaces_id: UUID | None
    title: Title
    style_guide_id: UUID
    sections: list[ReportSection]
    sources: list[EvidenceRecord]
    provenance: ReportProvenance
    content_hash: Hash
    section_hashes: dict[UUID, Hash]
    edits: list[ReportEdit]
    author: Literal["research_seed", "human"]
    change_note: Note
    created_at: datetime


class ReportAnchor(ResearchModel):
    start: int = Field(ge=0)
    end: int = Field(ge=1)
    quote: str = Field(min_length=1, max_length=6000)


class ReportFeedbackCreate(ResearchModel):
    id: UUID
    report_hash: Hash
    section_id: UUID | None = None
    section_hash: Hash | None = None
    anchor: ReportAnchor | None = None
    kind: Literal["comment", "preference", "decision"]
    value: Literal["accept", "reject", "prefer_current", "prefer_previous", "tie"] | None = None
    reason: Note

    @model_validator(mode="after")
    def feedback_kind(self) -> Self:
        if (self.section_id is None) != (self.section_hash is None):
            raise ValueError("A section ID and its hash must be supplied together.")
        if self.anchor and not self.section_id:
            raise ValueError("Select a section before anchoring a comment.")
        allowed: dict[str, set[str | None]] = {
            "comment": {None},
            "preference": {"prefer_current", "prefer_previous", "tie"},
            "decision": {"accept", "reject"},
        }
        if self.value not in allowed[self.kind]:
            raise ValueError("Choose a value matching the feedback type.")
        return self


class ReportFeedback(ReportFeedbackCreate):
    revision_id: UUID
    compared_revision_id: UUID | None
    compared_hash: Hash | None
    created_at: datetime
    actor: Literal["human"] = "human"
    training_consent: Literal[False] = False


class ReportView(ResearchModel):
    revision: ReportRevision
    current_revision_id: UUID
    style_guide: StyleGuide
    source_bases: dict[UUID, str]
    feedback: list[ReportFeedback]
    review_status: Literal["unreviewed", "accepted", "rejected"]


class ReportSummary(ResearchModel):
    id: UUID
    series_id: UUID
    version: int
    title: str
    created_at: datetime
    author: Literal["research_seed", "human"]
    change_note: str
