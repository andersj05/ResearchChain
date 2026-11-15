"""Preregister imported predictions; compare them with separately saved human labels."""

from collections import defaultdict
from datetime import UTC, datetime
from uuid import UUID

from psycopg.types.json import Jsonb

from researchchain.database import Database
from researchchain.evaluation_checks import digest, text_digest
from researchchain.evaluation_datasets import case_in, read_record, retry_record
from researchchain.evaluation_models import (
    EvaluationCalibration,
    EvaluationCandidate,
    EvaluationComparison,
    EvaluationDataset,
    EvaluationFeedback,
    EvaluationJudge,
    EvaluationJudgeCreate,
)
from researchchain.evaluation_reviews import check_hashes, comparison_lock, read_comparison
from researchchain.evidence import request_hash
from researchchain.revisions import ConflictError


class EvaluationJudges:
    def __init__(self, database: Database):
        self.database = database

    def create(self, key: UUID, request: EvaluationJudgeCreate) -> EvaluationJudge:
        with self.database.connection() as conn, conn.transaction():
            comparison_lock(conn, key)
            existing = retry_record(conn, "evaluation_judges", request.id, request, EvaluationJudge)
            if existing:
                row = conn.execute(
                    "SELECT comparison_id FROM evaluation_judges WHERE id = %s", (request.id,)
                ).fetchone()
                if row and row["comparison_id"] == key:
                    return existing
                raise ConflictError("Judge prediction ID belongs to another comparison.")
            view = read_comparison(conn, key)
            if view.feedback:
                raise ConflictError("Save judge predictions before the human label is revealed.")
            check_hashes(view, request.left_hash, request.right_hash)
            prompt_hash = text_digest(request.prompt)
            judge_key = digest([request.model, prompt_hash])
            if conn.execute(
                "SELECT 1 FROM evaluation_judges WHERE comparison_id = %s AND judge_key = %s",
                (key, judge_key),
            ).fetchone():
                raise ConflictError(
                    "This judge configuration already has a saved prediction for this pair."
                )
            record = EvaluationJudge(
                **request.model_dump(), prompt_hash=prompt_hash, created_at=datetime.now(UTC)
            )
            conn.execute(
                "INSERT INTO evaluation_judges (id,comparison_id,judge_key,request_hash,document) "
                "VALUES (%s,%s,%s,%s,%s)",
                (
                    record.id,
                    key,
                    judge_key,
                    request_hash(request),
                    Jsonb(record.model_dump(mode="json")),
                ),
            )
            return record

    def list_predictions(self, key: UUID) -> list[EvaluationJudge]:
        with self.database.connection() as conn:
            view = read_comparison(conn, key)
            if not view.feedback:
                raise ConflictError(
                    "Judge predictions remain hidden until human feedback is saved."
                )
            return [
                EvaluationJudge.model_validate(row["document"])
                for row in conn.execute(
                    "SELECT document FROM evaluation_judges "
                    "WHERE comparison_id = %s ORDER BY created_at,id",
                    (key,),
                )
            ]

    def calibration(self) -> list[EvaluationCalibration]:
        samples: dict[
            tuple[str, str, str, str, str], list[tuple[EvaluationJudge, EvaluationFeedback, str]]
        ] = defaultdict(list)
        excluded: dict[tuple[str, str, str, str, str], int] = defaultdict(int)
        with self.database.connection() as conn:
            for row in conn.execute(
                "SELECT j.document AS judge, c.document AS comparison, f.document AS feedback, "
                "c.left_id, c.right_id FROM evaluation_judges j "
                "JOIN evaluation_comparisons c ON c.id = j.comparison_id "
                "LEFT JOIN evaluation_feedback f ON f.comparison_id = c.id"
            ).fetchall():
                judge = EvaluationJudge.model_validate(row["judge"])
                view = EvaluationComparison.model_validate(row["comparison"])
                dataset = read_record(
                    conn, "evaluation_datasets", view.dataset_id, EvaluationDataset
                )
                case = case_in(dataset, view.case_id)
                candidates = [
                    read_record(conn, "evaluation_candidates", row[side], EvaluationCandidate)
                    for side in ("left_id", "right_id")
                ]
                group: tuple[str, str, str, str, str] = (
                    judge.model,
                    judge.prompt_version,
                    judge.prompt_hash,
                    view.track,
                    view.partition,
                )
                feedback = (
                    EvaluationFeedback.model_validate(row["feedback"]) if row["feedback"] else None
                )
                excluded[group] += 0
                if (
                    not feedback
                    or feedback.origin != "human"
                    or feedback.preference == "abstain"
                    or case.synthetic
                    or any(item.provenance.origin == "synthetic" for item in candidates)
                    or not view.left.checks.eligible
                    or not view.right.checks.eligible
                    or judge.created_at > feedback.created_at
                ):
                    excluded[group] += 1
                    continue
                samples[group].append((judge, feedback, f"{dataset.series_id}:{case.id}"))
        result = []
        for group in sorted(excluded):
            rows = samples[group]
            count = len(rows)
            cases = len({case for _, _, case in rows})
            accuracy = (
                sum(
                    max(
                        judge.probabilities,
                        key=lambda key: (
                            judge.probabilities[key],
                            -("left", "right", "tie").index(key),
                        ),
                    )
                    == feedback.preference
                    for judge, feedback, _ in rows
                )
                / count
                if count
                else None
            )
            brier = (
                sum(
                    sum(
                        (probability - (label == feedback.preference)) ** 2
                        for label, probability in judge.probabilities.items()
                    )
                    for judge, feedback, _ in rows
                )
                / count
                if count
                else None
            )
            result.append(
                EvaluationCalibration.model_validate(
                    {
                        "model": group[0],
                        "prompt_version": group[1],
                        "prompt_hash": group[2],
                        "track": group[3],
                        "partition": group[4],
                        "labeled_pairs": count,
                        "distinct_cases": cases,
                        "excluded_pairs": excluded[group],
                        "accuracy": accuracy,
                        "brier_score": brier,
                        "ready_for_calibration": count >= 20 and cases >= 5,
                        "note": (
                            "Exploratory agreement with human preference, not factual accuracy. "
                            "At least 20 eligible pairs across 5 cases are required "
                            "to begin calibration; "
                            "this minimum does not establish reliability. "
                            "Synthetic, abstained, unlabeled "
                            "and input-ineligible pairs are excluded. "
                            "Predictions are imported declarations."
                        ),
                    }
                )
            )
        return result
