"""Evaluation API: no model calls or automatic human labels."""

from uuid import UUID

from fastapi import APIRouter

from researchchain.database import Database
from researchchain.evaluation_archives import EvaluationArchives
from researchchain.evaluation_candidates import EvaluationCandidates
from researchchain.evaluation_datasets import EvaluationDatasets
from researchchain.evaluation_judges import EvaluationJudges
from researchchain.evaluation_models import (
    EvaluationArchive,
    EvaluationBundle,
    EvaluationCalibration,
    EvaluationCandidate,
    EvaluationCandidateCreate,
    EvaluationChecks,
    EvaluationComparison,
    EvaluationComparisonCreate,
    EvaluationComparisonSummary,
    EvaluationDataset,
    EvaluationDatasetCreate,
    EvaluationDatasetSummary,
    EvaluationFeedbackCreate,
    EvaluationInputs,
    EvaluationJudge,
    EvaluationJudgeCreate,
    EvaluationReference,
    EvaluationReferenceCreate,
)
from researchchain.evaluation_reviews import EvaluationReviews


def evaluation_router(database: Database) -> APIRouter:
    router = APIRouter(prefix="/api/evaluations")
    datasets = EvaluationDatasets(database)
    candidates = EvaluationCandidates(database)
    reviews = EvaluationReviews(database)
    judges = EvaluationJudges(database)
    archives = EvaluationArchives(database)

    @router.get("/references", operation_id="list_evaluation_references")
    def references() -> list[EvaluationReference]:
        return datasets.references()

    @router.post("/references", status_code=201, operation_id="create_evaluation_reference")
    def create_reference(request: EvaluationReferenceCreate) -> EvaluationReference:
        return datasets.create_reference(request)

    @router.get("/datasets", operation_id="list_evaluation_datasets")
    def list_datasets() -> list[EvaluationDatasetSummary]:
        return datasets.list()

    @router.post("/datasets", status_code=201, operation_id="create_evaluation_dataset")
    def create_dataset(request: EvaluationDatasetCreate) -> EvaluationDataset:
        return datasets.create(request)

    @router.get("/datasets/{dataset_id}", operation_id="get_evaluation_dataset")
    def get_dataset(dataset_id: UUID) -> EvaluationDataset:
        return datasets.get(dataset_id)

    @router.get(
        "/datasets/{dataset_id}/cases/{case_id}/checks", operation_id="check_evaluation_inputs"
    )
    def checks(dataset_id: UUID, case_id: str) -> EvaluationChecks:
        return datasets.checks(dataset_id, case_id)

    @router.get(
        "/datasets/{dataset_id}/cases/{case_id}/inputs", operation_id="get_evaluation_inputs"
    )
    def inputs(dataset_id: UUID, case_id: str) -> EvaluationInputs:
        return datasets.inputs(dataset_id, case_id)

    @router.get(
        "/datasets/{dataset_id}/cases/{case_id}/candidates",
        operation_id="list_evaluation_candidates",
    )
    def list_candidates(dataset_id: UUID, case_id: str) -> list[EvaluationCandidate]:
        return candidates.list(dataset_id, case_id)

    @router.post("/candidates", status_code=201, operation_id="create_evaluation_candidate")
    def create_candidate(request: EvaluationCandidateCreate) -> EvaluationCandidate:
        return candidates.create(request)

    @router.get("/comparisons", operation_id="list_evaluation_comparisons")
    def list_comparisons() -> list[EvaluationComparisonSummary]:
        return reviews.list()

    @router.post("/comparisons", status_code=201, operation_id="create_evaluation_comparison")
    def create_comparison(request: EvaluationComparisonCreate) -> EvaluationComparison:
        return reviews.create(request)

    @router.get("/comparisons/{comparison_id}", operation_id="get_evaluation_comparison")
    def get_comparison(comparison_id: UUID) -> EvaluationComparison:
        return reviews.get(comparison_id)

    @router.post(
        "/comparisons/{comparison_id}/feedback",
        status_code=201,
        operation_id="submit_evaluation_feedback",
    )
    def feedback(comparison_id: UUID, request: EvaluationFeedbackCreate) -> EvaluationComparison:
        return reviews.feedback(comparison_id, request)

    @router.post(
        "/comparisons/{comparison_id}/judges",
        status_code=201,
        operation_id="create_evaluation_judge",
    )
    def predict(comparison_id: UUID, request: EvaluationJudgeCreate) -> EvaluationJudge:
        return judges.create(comparison_id, request)

    @router.get("/comparisons/{comparison_id}/judges", operation_id="list_evaluation_judges")
    def list_judges(comparison_id: UUID) -> list[EvaluationJudge]:
        return judges.list_predictions(comparison_id)

    @router.get("/calibration", operation_id="get_evaluation_calibration")
    def calibration() -> list[EvaluationCalibration]:
        return judges.calibration()

    @router.get("/comparisons/{comparison_id}/export", operation_id="export_evaluation_comparison")
    def export(comparison_id: UUID) -> EvaluationBundle:
        return archives.export(comparison_id)

    @router.post("/archives", status_code=201, operation_id="import_evaluation_comparison")
    def import_bundle(bundle: EvaluationBundle) -> EvaluationArchive:
        return archives.import_bundle(bundle)

    @router.get("/archives", operation_id="list_evaluation_archives")
    def list_archives() -> list[EvaluationArchive]:
        return archives.list()

    return router
