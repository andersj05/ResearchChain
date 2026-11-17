"""Portable reviewed comparisons; imports are read-only, unverified archives."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from psycopg.types.json import Jsonb

from researchchain.artifacts import EvidenceError
from researchchain.database import Database
from researchchain.evaluation_checks import digest, text_digest
from researchchain.evaluation_datasets import case_in, read_record
from researchchain.evaluation_models import (
    EvaluationArchive,
    EvaluationBundle,
    EvaluationDataset,
    EvaluationDatasetCreate,
    EvaluationJudge,
)
from researchchain.evaluation_reviews import (
    check_hashes,
    qualified,
    read_comparison,
    validate_edits,
)
from researchchain.revisions import ConflictError


def validate_bundle(bundle: EvaluationBundle) -> None:
    if digest(bundle.model_dump(mode="json", exclude={"content_hash"})) != bundle.content_hash:
        raise EvidenceError("Comparison export checksum does not match its contents.")
    declared_dataset = bundle.dataset.model_dump(
        mode="json",
        include=set(EvaluationDatasetCreate.model_fields) - {"id"},
    )
    if digest(declared_dataset) != bundle.dataset.content_hash:
        raise EvidenceError("Dataset revision checksum does not match its contents.")
    view = bundle.comparison
    case = case_in(bundle.dataset, view.case_id)
    if view.dataset_id != bundle.dataset.id or (view.track, view.partition) != (
        case.track,
        case.partition,
    ):
        raise EvidenceError("Exported comparison does not match its dataset case.")
    if (view.brief, view.period_start, view.as_of_date, view.synthetic) != (
        case.brief,
        case.period_start,
        case.as_of_date,
        case.synthetic,
    ):
        raise EvidenceError("Exported comparison context does not match its case.")
    if not view.feedback or not view.reveal:
        raise EvidenceError("Only reviewed and revealed comparisons can be imported.")
    check_hashes(view, view.feedback.left_hash, view.feedback.right_hash)
    validate_edits(view, view.feedback)
    if (view.feedback.left_qualified, view.feedback.right_qualified) != (
        qualified(view.feedback.left_gates, view.left),
        qualified(view.feedback.right_gates, view.right),
    ):
        raise EvidenceError("Exported qualification does not match the saved gates.")
    if view.feedback.created_at < view.created_at:
        raise EvidenceError("Exported feedback predates its comparison.")
    for side, candidate in ((view.left, view.reveal.left), (view.right, view.reveal.right)):
        if (
            text_digest(side.text) != side.content_hash
            or candidate.text != side.text
            or candidate.content_hash != side.content_hash
            or candidate.artifact_id != "sha256:" + side.content_hash
            or (candidate.dataset_id, candidate.case_id) != (view.dataset_id, view.case_id)
        ):
            raise EvidenceError("Exported candidate content or identity does not match.")
    for reference in view.reveal.references:
        if reference.content_hash != "sha256:" + text_digest(reference.text):
            raise EvidenceError("Exported reference checksum does not match.")
    if {ref.id for ref in view.reveal.references} != set(case.reference_ids):
        raise EvidenceError("Exported references do not match the case.")
    for judge in bundle.judges:
        check_hashes(view, judge.left_hash, judge.right_hash)
        if (
            judge.prompt_hash != text_digest(judge.prompt)
            or judge.created_at > view.feedback.created_at
        ):
            raise EvidenceError("Exported judge prediction has an invalid prompt or chronology.")


class EvaluationArchives:
    def __init__(self, database: Database):
        self.database = database

    def export(self, key: UUID) -> EvaluationBundle:
        with self.database.connection() as conn:
            view = read_comparison(conn, key)
            if not view.feedback:
                raise ConflictError("Save human feedback before exporting a revealed comparison.")
            bundle = EvaluationBundle(
                dataset=read_record(
                    conn, "evaluation_datasets", view.dataset_id, EvaluationDataset
                ),
                comparison=view,
                judges=[
                    EvaluationJudge.model_validate(row["document"])
                    for row in conn.execute(
                        "SELECT document FROM evaluation_judges "
                        "WHERE comparison_id = %s ORDER BY created_at,id",
                        (key,),
                    )
                ],
                content_hash="0" * 64,
            )
            return bundle.model_copy(
                update={
                    "content_hash": digest(bundle.model_dump(mode="json", exclude={"content_hash"}))
                }
            )

    def import_bundle(self, bundle: EvaluationBundle) -> EvaluationArchive:
        validate_bundle(bundle)
        with self.database.connection() as conn, conn.transaction():
            conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                (f"archive:{bundle.content_hash}",),
            )
            row = conn.execute(
                "SELECT document FROM evaluation_archives WHERE content_hash = %s",
                (bundle.content_hash,),
            ).fetchone()
            if row:
                return EvaluationArchive.model_validate(row["document"])
            record = EvaluationArchive(
                id=uuid4(),
                content_hash=bundle.content_hash,
                title=bundle.comparison.title,
                created_at=datetime.now(UTC),
                bundle=bundle,
            )
            conn.execute(
                "INSERT INTO evaluation_archives (id,content_hash,document) VALUES (%s,%s,%s)",
                (record.id, record.content_hash, Jsonb(record.model_dump(mode="json"))),
            )
            return record

    def list(self) -> list[EvaluationArchive]:
        with self.database.connection() as conn:
            return [
                EvaluationArchive.model_validate(row["document"])
                for row in conn.execute(
                    "SELECT document FROM evaluation_archives "
                    "ORDER BY created_at DESC,id DESC LIMIT 20"
                )
            ]
