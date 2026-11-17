"""Randomized blind views and immutable, text-bound human judgments."""

import secrets
from datetime import UTC, datetime
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

from researchchain.artifacts import EvidenceError, read_content
from researchchain.database import Database
from researchchain.evaluation_checks import check_inputs, digest, input_text
from researchchain.evaluation_datasets import case_in, read_record
from researchchain.evaluation_models import (
    EvaluationCandidate,
    EvaluationComparison,
    EvaluationComparisonCreate,
    EvaluationComparisonSummary,
    EvaluationDataset,
    EvaluationFeedback,
    EvaluationFeedbackCreate,
    EvaluationGates,
    EvaluationReference,
    EvaluationReveal,
    EvaluationSide,
)
from researchchain.evidence import request_hash
from researchchain.revisions import ConflictError, NotFoundError


def comparison_lock(conn: Connection[DictRow], key: UUID) -> None:
    conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"comparison:{key}",))


def comparison_row(conn: Connection[DictRow], key: UUID) -> DictRow:
    row = conn.execute("SELECT * FROM evaluation_comparisons WHERE id = %s", (key,)).fetchone()
    if not row:
        raise NotFoundError("Comparison not found.")
    return row


def read_comparison(conn: Connection[DictRow], key: UUID) -> EvaluationComparison:
    row = comparison_row(conn, key)
    view = EvaluationComparison.model_validate(row["document"])
    feedback = conn.execute(
        "SELECT document FROM evaluation_feedback WHERE comparison_id = %s", (key,)
    ).fetchone()
    if not feedback:
        return view
    case = case_in(
        read_record(conn, "evaluation_datasets", view.dataset_id, EvaluationDataset), view.case_id
    )
    return view.model_copy(
        update={
            "feedback": EvaluationFeedback.model_validate(feedback["document"]),
            "reveal": EvaluationReveal(
                left=read_record(
                    conn, "evaluation_candidates", row["left_id"], EvaluationCandidate
                ),
                right=read_record(
                    conn, "evaluation_candidates", row["right_id"], EvaluationCandidate
                ),
                references=[
                    read_record(conn, "evaluation_references", ref, EvaluationReference)
                    for ref in case.reference_ids
                ],
            ),
        }
    )


def check_hashes(view: EvaluationComparison, left: str, right: str) -> None:
    if (view.left.content_hash, view.right.content_hash) != (left, right):
        raise ConflictError(
            "This feedback targets different displayed texts. Refresh the comparison."
        )


def qualified(gates: EvaluationGates, side: EvaluationSide) -> bool:
    return side.checks.eligible and all(
        value == "pass"
        for value in (
            gates.factual_accuracy,
            gates.numerical_accuracy,
            gates.citation_support,
        )
    )


def validate_edits(view: EvaluationComparison, feedback: EvaluationFeedbackCreate) -> None:
    for side in ("left", "right"):
        text = getattr(view, side).text
        edits = sorted(
            (item for item in feedback.edits if item.side == side),
            key=lambda item: (item.start, item.end),
        )
        previous_end = -1
        previous_start = -1
        for edit in edits:
            if edit.end > len(text) or text[edit.start : edit.end] != edit.original:
                raise EvidenceError(
                    "Edited spans must match the saved text using Unicode code point offsets."
                )
            if edit.start < previous_end or edit.start == previous_start:
                raise EvidenceError("Edited spans cannot overlap or share an insertion position.")
            previous_start, previous_end = edit.start, edit.end


class EvaluationReviews:
    def __init__(self, database: Database):
        self.database = database

    def create(self, request: EvaluationComparisonCreate) -> EvaluationComparison:
        with self.database.connection() as conn, conn.transaction():
            comparison_lock(conn, request.id)
            existing = conn.execute(
                "SELECT request_hash FROM evaluation_comparisons WHERE id = %s", (request.id,)
            ).fetchone()
            if existing:
                if existing["request_hash"] != request_hash(request):
                    raise ConflictError("Comparison ID already belongs to another pair.")
                return read_comparison(conn, request.id)
            candidates = [
                read_record(conn, "evaluation_candidates", key, EvaluationCandidate)
                for key in request.candidate_ids
            ]
            a, b = candidates
            if (a.dataset_id, a.case_id) != (b.dataset_id, b.case_id):
                raise EvidenceError("Compare candidates from the same case and dataset revision.")
            if a.content_hash == b.content_hash:
                raise EvidenceError("The candidates contain identical text.")
            pair_key = digest(
                [str(a.dataset_id), a.case_id, sorted([a.content_hash, b.content_hash])]
            )
            conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"pair:{pair_key}",)
            )
            if conn.execute(
                "SELECT 1 FROM evaluation_comparisons WHERE pair_key = %s", (pair_key,)
            ).fetchone():
                raise ConflictError(
                    "This candidate pair already has a comparison. Open it from the list."
                )
            case = case_in(
                read_record(conn, "evaluation_datasets", a.dataset_id, EvaluationDataset), a.case_id
            )
            if secrets.randbelow(2):
                candidates.reverse()
            left, right = candidates
            sides = []
            for item in candidates:
                # Recheck against the current reference registry before freezing the review.
                checks = check_inputs(
                    conn,
                    case,
                    item.provenance.evidence,
                    input_text(
                        conn,
                        item.provenance.evidence,
                        read_content(conn, item.provenance.generation_input_hash).decode(),
                    ),
                )
                if item.checks.input_match.status != "pass":
                    checks = checks.model_copy(
                        update={"input_match": item.checks.input_match, "eligible": False}
                    )
                sides.append(
                    EvaluationSide(text=item.text, content_hash=item.content_hash, checks=checks)
                )
            # Stable source order does not disclose which side used a particular source.
            sources = {
                source.id: source for item in candidates for source in item.provenance.evidence
            }
            view = EvaluationComparison(
                id=request.id,
                dataset_id=a.dataset_id,
                case_id=a.case_id,
                title=case.title,
                track=case.track,
                partition=case.partition,
                brief=case.brief,
                period_start=case.period_start,
                as_of_date=case.as_of_date,
                synthetic=case.synthetic,
                evidence=[sources[key] for key in sorted(sources)],
                left=sides[0],
                right=sides[1],
                created_at=datetime.now(UTC),
            )
            conn.execute(
                "INSERT INTO evaluation_comparisons "
                "(id,dataset_id,case_id,left_id,right_id,pair_key,request_hash,document) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    view.id,
                    view.dataset_id,
                    view.case_id,
                    left.id,
                    right.id,
                    pair_key,
                    request_hash(request),
                    Jsonb(view.model_dump(mode="json")),
                ),
            )
            return view

    def get(self, key: UUID) -> EvaluationComparison:
        with self.database.connection() as conn:
            return read_comparison(conn, key)

    def list(self) -> list[EvaluationComparisonSummary]:
        with self.database.connection() as conn:
            rows = conn.execute(
                "SELECT c.document, f.id IS NOT NULL AS reviewed FROM evaluation_comparisons c "
                "LEFT JOIN evaluation_feedback f ON f.comparison_id = c.id "
                "ORDER BY c.created_at DESC,c.id DESC LIMIT 100"
            )
            return [
                EvaluationComparisonSummary(
                    id=row["document"]["id"],
                    title=row["document"]["title"],
                    track=row["document"]["track"],
                    partition=row["document"]["partition"],
                    reviewed=row["reviewed"],
                    created_at=row["document"]["created_at"],
                )
                for row in rows
            ]

    def feedback(self, key: UUID, request: EvaluationFeedbackCreate) -> EvaluationComparison:
        with self.database.connection() as conn, conn.transaction():
            comparison_lock(conn, key)
            conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"feedback:{request.id}",)
            )
            view = read_comparison(conn, key)
            existing = conn.execute(
                "SELECT comparison_id, request_hash FROM evaluation_feedback "
                "WHERE id = %s OR comparison_id = %s",
                (request.id, key),
            ).fetchone()
            if existing:
                if existing["comparison_id"] != key or existing["request_hash"] != request_hash(
                    request
                ):
                    raise ConflictError(
                        "A saved review cannot be changed or reused for another pair."
                    )
                return view
            check_hashes(view, request.left_hash, request.right_hash)
            validate_edits(view, request)
            feedback = EvaluationFeedback(
                **request.model_dump(),
                created_at=datetime.now(UTC),
                left_qualified=qualified(request.left_gates, view.left),
                right_qualified=qualified(request.right_gates, view.right),
            )
            conn.execute(
                "INSERT INTO evaluation_feedback (id,comparison_id,request_hash,document) "
                "VALUES (%s,%s,%s,%s)",
                (feedback.id, key, request_hash(request), Jsonb(feedback.model_dump(mode="json"))),
            )
            return read_comparison(conn, key)
