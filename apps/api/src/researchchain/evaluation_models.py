"""Versioned evaluation inputs, immutable labels, and explicitly blind review views."""

from datetime import date
from math import isclose
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, Field, HttpUrl, model_validator

from researchchain.evidence_models import EvidenceRecord
from researchchain.research_models import Address, ResearchModel

Text = Annotated[str, Field(min_length=1, max_length=6000)]
Short = Annotated[str, Field(min_length=1, max_length=240)]
Hash = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
Track = Literal["frozen_writing", "full_research"]
Partition = Literal["development", "holdout"]
Preference = Literal["left", "right", "tie", "abstain"]
Gate = Literal["pass", "fail", "unassessed"]


class EvaluationReferenceCreate(ResearchModel):
    id: UUID
    title: Short
    text: str = Field(min_length=1, max_length=100000)
    origin: Literal["human_published", "human_supplied", "synthetic"]
    author: Short
    source_url: HttpUrl | None = None
    source_evidence_id: UUID | None = None
    development_only: bool = False

    @model_validator(mode="after")
    def safe_url(self) -> Self:
        if self.source_url and (self.source_url.username or self.source_url.password):
            raise ValueError("Reference URLs cannot contain credentials.")
        return self


class EvaluationReference(EvaluationReferenceCreate):
    content_hash: Address
    created_at: AwareDatetime


class EvaluationCase(ResearchModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")
    title: Short
    topic: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")
    partition: Partition
    track: Track
    brief: str = Field(min_length=1, max_length=10000)
    period_start: date | None = None
    as_of_date: date | None = None
    evidence_ids: list[UUID] = Field(min_length=1, max_length=100)
    reference_ids: list[UUID] = Field(default_factory=list, max_length=10)
    synthetic: bool = False

    @model_validator(mode="after")
    def consistency(self) -> Self:
        if bool(self.period_start) != bool(self.as_of_date):
            raise ValueError("A historical case needs both period start and as-of cutoff.")
        if self.period_start and self.as_of_date and self.period_start > self.as_of_date:
            raise ValueError("The historical period cannot end before it starts.")
        if len(set(self.evidence_ids)) != len(self.evidence_ids):
            raise ValueError("Select each evidence snapshot only once.")
        if len(set(self.reference_ids)) != len(self.reference_ids):
            raise ValueError("Select each reference only once.")
        return self


class EvaluationDatasetCreate(ResearchModel):
    id: UUID
    title: Short
    replaces_id: UUID | None = None
    cases: list[EvaluationCase] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def distinct_cases(self) -> Self:
        if len({case.id for case in self.cases}) != len(self.cases):
            raise ValueError("Case identifiers must be distinct within a dataset revision.")
        return self


class EvaluationDataset(EvaluationDatasetCreate):
    series_id: UUID
    version: int
    content_hash: Hash
    created_at: AwareDatetime


class EvaluationDatasetSummary(ResearchModel):
    id: UUID
    series_id: UUID
    version: int
    title: str
    case_count: int
    created_at: AwareDatetime


class EvaluationCheck(ResearchModel):
    status: Literal["pass", "fail", "unknown", "not_applicable"]
    findings: list[str]


class EvaluationChecks(ResearchModel):
    reference_exclusion: EvaluationCheck
    historical_cutoff: EvaluationCheck
    input_match: EvaluationCheck
    eligible: bool
    reference_registry_hash: Hash
    scope: Literal["metadata_and_copy_detection_only"] = "metadata_and_copy_detection_only"


class EvaluationInputs(ResearchModel):
    version: Literal["evaluation-inputs-1"] = "evaluation-inputs-1"
    dataset_id: UUID
    case_id: str
    track: Track
    brief: str
    as_of_date: date | None
    evidence: list[EvidenceRecord]
    checks: EvaluationChecks
    input_hash: Hash


class ImportedEvaluationOutput(ResearchModel):
    type: Literal["imported"] = "imported"
    text: str = Field(min_length=1, max_length=100000)
    origin: Literal["model", "human", "synthetic"]
    model: Short
    workflow_version: Short
    prompt_version: Short
    tool_version: Short
    evidence_ids: list[UUID] = Field(min_length=1, max_length=100)
    generation_input: str = Field(min_length=1, max_length=200000)


class RecordedEvaluationOutput(ResearchModel):
    type: Literal["run"] = "run"
    run_id: UUID
    attempt_id: UUID


class EvaluationCandidateCreate(ResearchModel):
    id: UUID
    dataset_id: UUID
    case_id: str
    label: Short
    source: Annotated[
        ImportedEvaluationOutput | RecordedEvaluationOutput, Field(discriminator="type")
    ]


class EvaluationProvenance(ResearchModel):
    verification: Literal["recorded_run", "declared_import"]
    origin: Literal["model", "human", "synthetic"]
    model: str
    workflow_version: str
    workflow_hash: str
    prompt_versions: dict[str, str]
    prompt_hashes: dict[str, str]
    tool_version: str
    tool_config_hash: str
    evidence: list[EvidenceRecord]
    generation_input_hash: Address
    run_id: UUID | None = None
    attempt_id: UUID | None = None
    renderer: Literal["research-text-1", "plain-text-1"]


class EvaluationCandidate(ResearchModel):
    id: UUID
    dataset_id: UUID
    case_id: str
    label: str
    text: str
    content_hash: Hash
    artifact_id: Address
    provenance: EvaluationProvenance
    checks: EvaluationChecks
    created_at: AwareDatetime


class EvaluationComparisonCreate(ResearchModel):
    id: UUID
    candidate_ids: list[UUID] = Field(min_length=2, max_length=2)

    @model_validator(mode="after")
    def distinct(self) -> Self:
        if self.candidate_ids[0] == self.candidate_ids[1]:
            raise ValueError("Choose two distinct candidates.")
        return self


class EvaluationSide(ResearchModel):
    text: str
    content_hash: Hash
    checks: EvaluationChecks


class EvaluationGates(ResearchModel):
    factual_accuracy: Gate = "unassessed"
    numerical_accuracy: Gate = "unassessed"
    citation_support: Gate = "unassessed"
    reason: Text


class EvaluationRatings(ResearchModel):
    analytical_depth: int | None = Field(default=None, ge=1, le=5)
    counterarguments: int | None = Field(default=None, ge=1, le=5)
    scenarios: int | None = Field(default=None, ge=1, le=5)
    clarity: int | None = Field(default=None, ge=1, le=5)
    voice: int | None = Field(default=None, ge=1, le=5)
    edit_burden: int | None = Field(default=None, ge=1, le=5)


class EvaluationEdit(ResearchModel):
    side: Literal["left", "right"]
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    original: str = Field(max_length=100000)
    replacement: str = Field(max_length=100000)
    reason: Text

    @model_validator(mode="after")
    def valid_range(self) -> Self:
        if self.end < self.start:
            raise ValueError("Edited span ends before it starts.")
        if self.original == self.replacement:
            raise ValueError("An edit must change the saved text.")
        return self


class EvaluationFeedbackCreate(ResearchModel):
    id: UUID
    left_hash: Hash
    right_hash: Hash
    preference: Preference
    reason: Text
    origin: Literal["human", "synthetic"] = "human"
    left_gates: EvaluationGates
    right_gates: EvaluationGates
    left_ratings: EvaluationRatings = Field(default_factory=EvaluationRatings)
    right_ratings: EvaluationRatings = Field(default_factory=EvaluationRatings)
    edits: list[EvaluationEdit] = Field(default_factory=list, max_length=50)


class EvaluationFeedback(EvaluationFeedbackCreate):
    created_at: AwareDatetime
    left_qualified: bool
    right_qualified: bool
    indexing: Literal["unicode_code_points"] = "unicode_code_points"


class EvaluationReveal(ResearchModel):
    left: EvaluationCandidate
    right: EvaluationCandidate
    references: list[EvaluationReference]


class EvaluationComparison(ResearchModel):
    id: UUID
    dataset_id: UUID
    case_id: str
    title: str
    track: Track
    partition: Partition
    brief: str
    evidence: list[EvidenceRecord]
    left: EvaluationSide
    right: EvaluationSide
    created_at: AwareDatetime
    feedback: EvaluationFeedback | None = None
    reveal: EvaluationReveal | None = None


class EvaluationComparisonSummary(ResearchModel):
    id: UUID
    title: str
    track: Track
    partition: Partition
    reviewed: bool
    created_at: AwareDatetime


class EvaluationJudgeCreate(ResearchModel):
    id: UUID
    model: Short
    prompt_version: Short
    prompt: str = Field(min_length=1, max_length=20000)
    left_hash: Hash
    right_hash: Hash
    probabilities: dict[Literal["left", "right", "tie"], float]
    reason: Text

    @model_validator(mode="after")
    def probabilities_sum(self) -> Self:
        if (
            set(self.probabilities) != {"left", "right", "tie"}
            or any(not 0 <= value <= 1 for value in self.probabilities.values())
            or not isclose(sum(self.probabilities.values()), 1, abs_tol=1e-6)
        ):
            raise ValueError("Left, right and tie probabilities must be finite and sum to one.")
        return self


class EvaluationJudge(EvaluationJudgeCreate):
    prompt_hash: Hash
    created_at: AwareDatetime
    source: Literal["imported_prediction"] = "imported_prediction"


class EvaluationCalibration(ResearchModel):
    model: str
    prompt_version: str
    prompt_hash: Hash
    track: Track
    partition: Partition
    labeled_pairs: int
    distinct_cases: int
    excluded_pairs: int
    accuracy: float | None
    brier_score: float | None
    ready_for_calibration: bool
    note: str


class EvaluationBundle(ResearchModel):
    version: Literal["evaluation-comparison-1"] = "evaluation-comparison-1"
    dataset: EvaluationDataset
    comparison: EvaluationComparison
    judges: list[EvaluationJudge]
    content_hash: Hash


class EvaluationArchive(ResearchModel):
    id: UUID
    content_hash: Hash
    title: str
    created_at: AwareDatetime
    bundle: EvaluationBundle
    status: Literal["imported_unverified"] = "imported_unverified"
