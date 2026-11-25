"""Immutable source and claim contracts. Source content is always untrusted data."""

from datetime import date, datetime
from typing import Annotated, Any, Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, Field, HttpUrl, field_validator, model_validator

from researchchain.graph import StrictModel
from researchchain.models import ArtifactRef

ContentId = Annotated[str, Field(pattern=r"^sha256:[a-f0-9]{64}$")]
AccessRights = Literal[
    "unknown", "owned", "public_domain", "open_license", "permission", "restricted"
]
UploadRights = Literal["owned", "public_domain", "open_license", "permission"]
EvidenceKind = Literal["link", "report", "discussion", "image", "dataset", "text"]
EvidenceAvailability = Literal["available", "reference_only", "missing", "paywalled"]
Representation = Literal[
    "original", "chart_screenshot", "ocr_interpretation", "digitized_estimate", "numeric_data"
]


class EvidenceModel(StrictModel):
    @field_validator("*")
    @classmethod
    def storable_text(cls, value: Any) -> Any:
        if isinstance(value, str):
            if "\x00" in value:
                raise ValueError("Evidence metadata and text cannot contain null characters.")
            try:
                value.encode("utf-8")
            except UnicodeEncodeError as error:
                raise ValueError("Evidence text must contain valid Unicode characters.") from error
        return value


class SourceLocation(EvidenceModel):
    page_start: int | None = Field(default=None, ge=1, le=1000000)
    page_end: int | None = Field(default=None, ge=1, le=1000000)
    section: str = Field(default="", max_length=500)
    excerpt: str = Field(default="", max_length=6000)

    @model_validator(mode="after")
    def page_order(self) -> Self:
        if self.page_end is not None and (
            self.page_start is None or self.page_end < self.page_start
        ):
            raise ValueError("Page end requires a start page and cannot precede it.")
        return self


class ArtifactInfo(ArtifactRef):
    byte_size: int = Field(ge=1, le=20 * 1024 * 1024)
    created_at: datetime


class ContentPreview(StrictModel):
    text: str = ""
    truncated: bool = False
    columns: list[str] = Field(default_factory=list)
    rows: list[list[str]] = Field(default_factory=list)
    row_count: int | None = None
    numeric_columns: list[str] = Field(default_factory=list)
    parser_version: Literal["csv-1"] | None = None


class EvidenceFields(EvidenceModel):
    id: UUID
    title: str = Field(min_length=1, max_length=240)
    kind: EvidenceKind
    representation: Representation = "original"
    availability: EvidenceAvailability = "available"
    source_url: HttpUrl | None = Field(default=None, max_length=2000)
    author: str = Field(default="", max_length=240)
    publisher: str = Field(default="", max_length=240)
    published_date: date | None = None
    retrieved_at: AwareDatetime | None = None
    as_of_date: date | None = None
    rights: AccessRights = "unknown"
    rights_note: str = Field(default="", max_length=2000)
    location: SourceLocation = Field(default_factory=SourceLocation)
    parent_id: UUID | None = None
    replaces_id: UUID | None = None
    method: str = Field(default="", max_length=4000)
    table_format: Literal["csv", "tsv"] | None = None
    units: str = Field(default="", max_length=1000)
    uncertainty: str = Field(default="", max_length=2000)
    notes: str = Field(default="", max_length=6000)

    @model_validator(mode="after")
    def provenance(self) -> Self:
        if self.source_url and (self.source_url.username or self.source_url.password):
            raise ValueError("Source URLs cannot contain credentials.")
        if self.id in (self.parent_id, self.replaces_id):
            raise ValueError("An evidence record cannot derive from or replace itself.")
        if self.representation in ("ocr_interpretation", "digitized_estimate"):
            if self.parent_id is None or not self.method.strip():
                raise ValueError(
                    "Interpretations and estimates require a parent source and method."
                )
        if self.representation == "digitized_estimate" and (
            not self.units.strip() or not self.uncertainty.strip()
        ):
            raise ValueError("Digitized estimates require units and an uncertainty statement.")
        if self.representation == "numeric_data" and (
            not self.units.strip() or not self.method.strip()
        ):
            raise ValueError(
                "Numeric data requires units and a reproducible source/method description."
            )
        if self.representation in ("numeric_data", "digitized_estimate") and not self.table_format:
            raise ValueError("Numeric records require an explicit CSV or TSV format.")
        return self


class EvidenceCreate(EvidenceFields):
    artifact_id: ContentId | None = None
    text: str = Field(default="", max_length=200000)

    @model_validator(mode="after")
    def content(self) -> Self:
        supplied = self.artifact_id is not None or bool(self.text)
        if self.artifact_id and self.text:
            raise ValueError(
                "Store a file or supplied text per record; link derived text to its parent."
            )
        if self.availability == "available":
            if not supplied:
                raise ValueError("Available evidence requires captured content.")
            if self.rights in ("unknown", "restricted"):
                raise ValueError(
                    "Captured content requires permission or another permitted access right."
                )
        elif supplied:
            raise ValueError(
                "Uncaptured sources cannot include content; use available for captured material."
            )
        if not supplied and self.source_url is None:
            raise ValueError("An uncaptured source requires its original URL.")
        return self


class EvidenceRecord(EvidenceFields):
    artifact: ArtifactInfo | None = None
    content_hash: str | None = None
    created_at: datetime
    captured_at: datetime | None = None
    capture_method: Literal["user_upload", "user_text", "reference"]
    untrusted: Literal[True] = True
    preview: ContentPreview = Field(default_factory=ContentPreview)


class EvidencePage(StrictModel):
    items: list[EvidenceRecord]
    total: int
    next_offset: int | None = None


class ClaimLink(EvidenceModel):
    evidence_id: UUID
    relation: Literal["supports", "contradicts", "context"]
    location: SourceLocation = Field(default_factory=SourceLocation)
    rationale: str = Field(default="", max_length=3000)


class ClaimCreate(EvidenceModel):
    id: UUID
    text: str = Field(min_length=1, max_length=6000)
    kind: Literal["hypothesis", "observation", "interpretation"] = "hypothesis"
    as_of_date: date | None = None
    replaces_id: UUID | None = None
    links: list[ClaimLink] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def references(self) -> Self:
        if self.replaces_id == self.id:
            raise ValueError("A claim cannot replace itself.")
        keys = [(link.evidence_id, link.relation) for link in self.links]
        if len(keys) != len(set(keys)):
            raise ValueError("Duplicate evidence relationships are not supported.")
        return self


class ClaimRecord(ClaimCreate):
    created_at: datetime


class ClaimPage(StrictModel):
    items: list[ClaimRecord]
    total: int
    next_offset: int | None = None
