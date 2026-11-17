"""Versioned research results and safe public execution manifests."""

from datetime import datetime
from typing import Annotated, Any, Literal, Self
from uuid import UUID

from pydantic import Field, model_validator

from researchchain.graph import ResearchSettings, ResearchStage, StrictModel
from researchchain.web_research import WebResearch

Address = Annotated[str, Field(pattern=r"^sha256:[a-f0-9]{64}$")]
Sentence = Annotated[str, Field(min_length=1, max_length=3000)]


class ResearchModel(StrictModel):
    @model_validator(mode="after")
    def storable(self) -> Self:
        def validate(value: Any) -> None:
            if isinstance(value, str):
                if "\x00" in value:
                    raise ValueError("Research text cannot contain null characters.")
                value.encode("utf-8")
            elif isinstance(value, list):
                for item in value:
                    validate(item)
            elif isinstance(value, dict):
                for item in value.values():
                    validate(item)

        try:
            validate(self.model_dump(mode="json"))
        except UnicodeError:
            raise ValueError("Research text must contain valid Unicode.") from None
        return self


class ResearchCitation(ResearchModel):
    evidence_id: UUID
    relation: Literal["supports", "contradicts", "context"]
    basis: Literal[
        "source_text",
        "numeric_source",
        "image_interpretation",
        "document_interpretation",
        "ocr_interpretation",
        "estimate",
        "metadata_only",
    ]
    locator: str = Field(min_length=1, max_length=500)
    quote: str = Field(max_length=2000)
    rationale: Sentence


class Hypothesis(ResearchModel):
    id: str = Field(pattern=r"^H[1-9][0-9]{0,2}$")
    statement: Sentence
    alternatives: list[Sentence] = Field(min_length=1, max_length=8)
    falsifiers: list[Sentence] = Field(min_length=1, max_length=8)
    assessment: Literal["untested", "supported", "contradicted", "mixed"]
    citations: list[ResearchCitation] = Field(max_length=20)

    @model_validator(mode="after")
    def supported_by_content(self) -> Self:
        if self.assessment != "untested" and not any(
            citation.basis != "metadata_only" for citation in self.citations
        ):
            raise ValueError(
                "An assessed hypothesis needs captured evidence, not just a reference."
            )
        return self


class EvidenceRequest(ResearchModel):
    question: Sentence
    source_needed: Sentence
    why: Sentence


class ResearchResult(ResearchModel):
    schema_version: Literal["research-result-1"]
    stage: ResearchStage
    hypotheses: list[Hypothesis] = Field(max_length=8)
    unresolved_questions: list[Sentence] = Field(max_length=20)
    evidence_requests: list[EvidenceRequest] = Field(max_length=12)
    conclusion: str = Field(min_length=1, max_length=6000)
    revision_summary: Sentence
    limitations: list[Sentence] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def unique_hypotheses(self) -> Self:
        if self.stage != "custom" and not self.hypotheses:
            raise ValueError("Research stages require at least one hypothesis.")
        if len({item.id for item in self.hypotheses}) != len(self.hypotheses):
            raise ValueError("Hypothesis IDs must be distinct.")
        return self


class StoredResearchResult(ResearchResult):
    """Metadata added by the server; never part of the model output schema."""

    web_research: WebResearch | None = Field(default=None, exclude_if=lambda value: value is None)


class EvidenceSnapshot(StrictModel):
    evidence_id: UUID
    original: Address | None
    representation: str
    availability: str
    publisher: str
    source_url: str | None
    as_of_date: str | None


class ResearchManifest(StrictModel):
    version: Literal["research-manifest-1"] = "research-manifest-1"
    settings: ResearchSettings
    account_id: str
    account_label: str
    workflow_revision_id: UUID
    compiler_version: Literal["research-0.3.0"] = "research-0.3.0"
    prompt_versions: dict[str, str]
    prompt_hashes: dict[str, str]
    tool_config: dict[str, Any]
    evidence: list[EvidenceSnapshot]
    created_at: datetime


class ModelAttempt(StrictModel):
    admission_policy_revision: int | None = Field(default=None, ge=1)
    id: UUID
    path: str
    stage: ResearchStage
    model: str
    returned_model: str | None = None
    status: Literal[
        "preparing", "requesting", "completed", "failed", "unknown", "cancelled", "limited"
    ]
    input_artifact_id: Address | None = None
    response_artifact_id: Address | None = None
    input_bytes: int = 0
    output_characters: int = 0
    input_tokens: int | None = None
    output_tokens: int | None = None
    response_id: str | None = None
    reason: str | None = None
    result: StoredResearchResult | None = None
    created_at: datetime
    finished_at: datetime | None = None


class ProviderAccount(StrictModel):
    id: str
    label: str
    email: str | None = None
    signed_in: bool
    plan_enabled: bool
    active: bool


class ProviderModel(StrictModel):
    slug: str
    display_name: str


class ProviderStatus(StrictModel):
    provider: Literal["chatgpt_plan"] = "chatgpt_plan"
    accounts: list[ProviderAccount]
    models: list[ProviderModel] = Field(default_factory=list)
    error: str | None = None
    usage_url: Literal["https://chatgpt.com/settings/usage"] = "https://chatgpt.com/settings/usage"
