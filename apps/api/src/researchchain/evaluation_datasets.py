"""Immutable reference/dataset storage and generation input allowlists."""

from datetime import UTC, datetime
from uuid import UUID

from psycopg import Connection, sql
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

from researchchain.artifacts import EvidenceError, put_artifact
from researchchain.database import Database
from researchchain.evaluation_checks import check_inputs, digest, input_text
from researchchain.evaluation_models import (
    EvaluationCase,
    EvaluationChecks,
    EvaluationDataset,
    EvaluationDatasetCreate,
    EvaluationDatasetSummary,
    EvaluationInputs,
    EvaluationReference,
    EvaluationReferenceCreate,
)
from researchchain.evidence import read_evidence, request_hash
from researchchain.research_models import ResearchModel
from researchchain.revisions import ConflictError, NotFoundError

ANCHOR = "https://equitycats.substack.com/p/mixed-signals-rotations-and-correlations"


def read_record[T: ResearchModel](
    conn: Connection[DictRow], table: str, key: UUID, model: type[T]
) -> T:
    row = conn.execute(
        sql.SQL("SELECT document FROM {} WHERE id = %s").format(sql.Identifier(table)), (key,)
    ).fetchone()
    if not row:
        raise NotFoundError("Evaluation record not found.")
    return model.model_validate(row["document"])


def retry_record[T: ResearchModel](
    conn: Connection[DictRow], table: str, key: UUID, request: ResearchModel, model: type[T]
) -> T | None:
    conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"{table}:{key}",))
    row = conn.execute(
        sql.SQL("SELECT request_hash, document FROM {} WHERE id = %s").format(
            sql.Identifier(table)
        ),
        (key,),
    ).fetchone()
    if row:
        if row["request_hash"] != request_hash(request):
            raise ConflictError("This evaluation ID already belongs to different inputs.")
        return model.model_validate(row["document"])
    return None


def case_in(dataset: EvaluationDataset, case_id: str) -> EvaluationCase:
    case = next((item for item in dataset.cases if item.id == case_id), None)
    if case is None:
        raise NotFoundError("Evaluation case not found in this revision.")
    return case


def overlaps(a: EvaluationCase, b: EvaluationCase) -> bool:
    if a.partition == b.partition:
        return False
    if set(a.evidence_ids) & set(b.evidence_ids):
        return True
    if a.topic != b.topic:
        return False
    if not (a.period_start and a.as_of_date and b.period_start and b.as_of_date):
        return True
    return a.period_start <= b.as_of_date and b.period_start <= a.as_of_date


class EvaluationDatasets:
    def __init__(self, database: Database):
        self.database = database

    def create_reference(self, request: EvaluationReferenceCreate) -> EvaluationReference:
        with self.database.connection() as conn, conn.transaction():
            existing = retry_record(
                conn, "evaluation_references", request.id, request, EvaluationReference
            )
            if existing:
                return existing
            if request.source_evidence_id:
                read_evidence(conn, request.source_evidence_id)
            original = put_artifact(
                conn, request.text.encode("utf-8"), f"evaluation-reference-{request.id}.txt"
            )
            document = request.model_dump()
            if (
                request.source_url
                and str(request.source_url).split("?")[0].split("#")[0].rstrip("/") == ANCHOR
            ):
                document["development_only"] = True
            record = EvaluationReference(
                **document, content_hash=original.id, created_at=datetime.now(UTC)
            )
            conn.execute(
                "INSERT INTO evaluation_references (id, request_hash, document) VALUES (%s,%s,%s)",
                (record.id, request_hash(request), Jsonb(record.model_dump(mode="json"))),
            )
            return record

    def references(self) -> list[EvaluationReference]:
        with self.database.connection() as conn:
            return [
                EvaluationReference.model_validate(row["document"])
                for row in conn.execute(
                    "SELECT document FROM evaluation_references "
                    "ORDER BY created_at DESC, id DESC LIMIT 100"
                )
            ]

    def create(self, request: EvaluationDatasetCreate) -> EvaluationDataset:
        with self.database.connection() as conn, conn.transaction():
            conn.execute("SELECT pg_advisory_xact_lock(hashtextextended('evaluation-splits', 0))")
            existing = retry_record(
                conn, "evaluation_datasets", request.id, request, EvaluationDataset
            )
            if existing:
                return existing
            previous = (
                read_record(conn, "evaluation_datasets", request.replaces_id, EvaluationDataset)
                if request.replaces_id
                else None
            )
            if (
                previous
                and conn.execute(
                    "SELECT 1 FROM evaluation_datasets WHERE replaces_id = %s", (previous.id,)
                ).fetchone()
            ):
                raise ConflictError(
                    "This dataset revision already has a successor. Refresh before editing."
                )
            prior_cases = [
                case
                for row in conn.execute("SELECT document FROM evaluation_datasets")
                for case in EvaluationDataset.model_validate(row["document"]).cases
            ]
            snapshots: dict[UUID, str | None] = {}
            for case in [*prior_cases, *request.cases]:
                for evidence_id in case.evidence_ids:
                    if evidence_id not in snapshots:
                        snapshots[evidence_id] = read_evidence(conn, evidence_id).content_hash
            for case in request.cases:
                if case.as_of_date and case.as_of_date > datetime.now(UTC).date():
                    raise EvidenceError("Historical cutoffs cannot be in the future.")
                references = [
                    read_record(conn, "evaluation_references", key, EvaluationReference)
                    for key in case.reference_ids
                ]
                if case.partition == "holdout" and any(ref.development_only for ref in references):
                    raise EvidenceError("Development exemplars cannot be holdout references.")
                for other in [*prior_cases, *request.cases]:
                    shared_bytes = {
                        snapshots[key] for key in case.evidence_ids if snapshots[key]
                    } & {snapshots[key] for key in other.evidence_ids if snapshots[key]}
                    if overlaps(case, other) or (
                        case.partition != other.partition
                        and (shared_bytes or set(case.reference_ids) & set(other.reference_ids))
                    ):
                        raise EvidenceError(
                            "Development and holdout cases must use separate "
                            "topics/periods and evidence snapshots."
                        )
            record = EvaluationDataset(
                **request.model_dump(),
                series_id=previous.series_id if previous else request.id,
                version=previous.version + 1 if previous else 1,
                content_hash=digest(request.model_dump(mode="json", exclude={"id"})),
                created_at=datetime.now(UTC),
            )
            conn.execute(
                "INSERT INTO evaluation_datasets "
                "(id,series_id,version,replaces_id,request_hash,document) "
                "VALUES (%s,%s,%s,%s,%s,%s)",
                (
                    record.id,
                    record.series_id,
                    record.version,
                    record.replaces_id,
                    request_hash(request),
                    Jsonb(record.model_dump(mode="json")),
                ),
            )
            return record

    def get(self, key: UUID) -> EvaluationDataset:
        with self.database.connection() as conn:
            return read_record(conn, "evaluation_datasets", key, EvaluationDataset)

    def list(self) -> list[EvaluationDatasetSummary]:
        with self.database.connection() as conn:
            records = [
                EvaluationDataset.model_validate(row["document"])
                for row in conn.execute(
                    "SELECT document FROM evaluation_datasets "
                    "ORDER BY created_at DESC,id DESC LIMIT 100"
                )
            ]
        return [
            EvaluationDatasetSummary(
                id=item.id,
                series_id=item.series_id,
                version=item.version,
                title=item.title,
                case_count=len(item.cases),
                created_at=item.created_at,
            )
            for item in records
        ]

    def _inputs(self, dataset_id: UUID, case_id: str) -> EvaluationInputs:
        with self.database.connection() as conn:
            case = case_in(
                read_record(conn, "evaluation_datasets", dataset_id, EvaluationDataset), case_id
            )
            evidence = [read_evidence(conn, key) for key in case.evidence_ids]
            checks = check_inputs(conn, case, evidence, input_text(conn, evidence, case.brief))
            # Reference IDs/text and grading targets never enter this allowlisted packet.
            packet = EvaluationInputs(
                dataset_id=dataset_id,
                case_id=case.id,
                track=case.track,
                brief=case.brief,
                as_of_date=case.as_of_date,
                evidence=evidence,
                checks=checks,
                input_hash="0" * 64,
            )
            return packet.model_copy(
                update={
                    "input_hash": digest(packet.model_dump(mode="json", exclude={"input_hash"}))
                }
            )

    def checks(self, dataset_id: UUID, case_id: str) -> EvaluationChecks:
        return self._inputs(dataset_id, case_id).checks

    def inputs(self, dataset_id: UUID, case_id: str) -> EvaluationInputs:
        packet = self._inputs(dataset_id, case_id)
        if not packet.checks.eligible:
            raise EvidenceError(
                "Generation packet is blocked by input checks. Inspect the case checks first."
            )
        return packet
