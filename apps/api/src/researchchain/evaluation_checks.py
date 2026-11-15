"""Conservative, reproducible input checks; these never claim semantic correctness."""

import hashlib
import json
import re
from typing import Any

from psycopg import Connection
from psycopg.rows import DictRow

from researchchain.artifacts import EvidenceError, read_content
from researchchain.evaluation_models import (
    EvaluationCase,
    EvaluationCheck,
    EvaluationChecks,
    EvaluationReference,
)
from researchchain.evidence_models import EvidenceRecord
from researchchain.research_prompt import json_bytes


def digest(value: Any) -> str:
    return hashlib.sha256(json_bytes(value)).hexdigest()


def text_digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def words(text: str) -> str:
    return " ".join(re.findall(r"\w+", text.casefold()))


def strings(value: Any) -> list[str]:
    if isinstance(value, str):
        try:
            nested = json.loads(value)
        except ValueError:
            return [value]
        return strings(nested) if isinstance(nested, dict | list) else [value]
    if isinstance(value, list):
        return [text for item in value for text in strings(item)]
    if isinstance(value, dict):
        return [text for item in value.values() for text in strings(item)]
    return []


def plain_text(text: str) -> str:
    try:
        return "\n".join(strings(json.loads(text)))
    except ValueError:
        return text


def input_text(conn: Connection[DictRow], evidence: list[EvidenceRecord], seed: str) -> str:
    parts = [plain_text(seed), *[plain_text(item.model_dump_json()) for item in evidence]]
    total = 0
    for item in evidence:
        if item.artifact:
            total += item.artifact.byte_size
            if total > 8_000_000:
                raise EvidenceError("Evaluation inputs exceed the 8 MB packet budget.")
            if item.artifact.media_type.startswith("text/"):
                parts.append(read_content(conn, item.artifact.id).decode("utf-8-sig"))
    return "\n".join(parts)


def copied_reference(text: str, references: list[EvaluationReference]) -> bool:
    normalized = words(plain_text(text))
    for reference in references:
        full = words(reference.text)
        if len(full) >= 40 and full in normalized:
            return True
        tokens = full.split()
        for index in range(max(0, len(tokens) - 11)):
            excerpt = " ".join(tokens[index : index + 12])
            if len(excerpt) >= 80 and excerpt in normalized:
                return True
    return False


def check_inputs(
    conn: Connection[DictRow],
    case: EvaluationCase,
    evidence: list[EvidenceRecord],
    input_text: str,
    *,
    brief: str | None = None,
) -> EvaluationChecks:
    references = [
        EvaluationReference.model_validate(row["document"])
        for row in conn.execute("SELECT document FROM evaluation_references")
    ]
    reference_notes = []
    forbidden_ids = {ref.source_evidence_id for ref in references if ref.source_evidence_id}
    forbidden_hashes = {ref.content_hash for ref in references}
    if forbidden_ids:
        forbidden_hashes.update(
            row["artifact_id"]
            for row in conn.execute(
                "SELECT artifact_id FROM evidence_records WHERE id = ANY(%s)",
                (list(forbidden_ids),),
            )
            if row["artifact_id"]
        )
    ancestors = list(
        conn.execute(
            "WITH RECURSIVE lineage AS (SELECT id, parent_id, replaces_id, artifact_id, document "
            "FROM evidence_records WHERE id = ANY(%s) UNION SELECT e.id, e.parent_id, "
            "e.replaces_id, e.artifact_id, e.document FROM evidence_records e JOIN lineage l "
            "ON e.id = l.parent_id OR e.id = l.replaces_id) "
            "SELECT id, artifact_id, document FROM lineage",
            ([item.id for item in evidence],),
        )
    )
    if any(
        row["id"] in forbidden_ids or row["artifact_id"] in forbidden_hashes for row in ancestors
    ):
        reference_notes.append(
            "An input or its source lineage contains registered reference material."
        )
    if copied_reference(input_text, references):
        reference_notes.append(
            "Generation inputs contain an exact or substantial copied reference passage."
        )
    historical_fail = []
    historical_unknown = []
    if case.as_of_date:
        for source in [EvidenceRecord.model_validate(row["document"]) for row in ancestors]:
            label = str(source.id)
            if source.published_date and source.published_date > case.as_of_date:
                historical_fail.append(f"{label}: publication is after the historical cutoff.")
            if source.as_of_date and source.as_of_date > case.as_of_date:
                historical_fail.append(f"{label}: data as-of date is after the historical cutoff.")
            if not source.published_date:
                historical_unknown.append(f"{label}: publication date is missing.")
            if source.representation == "numeric_data" and not source.as_of_date:
                historical_unknown.append(f"{label}: numeric data vintage is missing.")
            if not source.captured_at or source.captured_at.date() > case.as_of_date:
                historical_unknown.append(
                    f"{label}: no bytes captured by the cutoff verify this vintage."
                )
            if source.availability != "available":
                historical_unknown.append(f"{label}: source content is not captured.")
    historical = EvaluationCheck(
        status="not_applicable"
        if not case.as_of_date
        else "fail"
        if historical_fail
        else "unknown"
        if historical_unknown
        else "pass",
        findings=historical_fail + historical_unknown,
    )
    selected = {source.id for source in evidence}
    required = set(case.evidence_ids)
    match = selected == required if case.track == "frozen_writing" else required <= selected
    mismatch = [] if match else ["Candidate evidence does not match the case's required snapshots."]
    if brief is not None and brief != case.brief:
        mismatch.append("The recorded run brief differs from the evaluation case.")
    refs = EvaluationCheck(status="fail" if reference_notes else "pass", findings=reference_notes)
    matched = EvaluationCheck(status="fail" if mismatch else "pass", findings=mismatch)
    return EvaluationChecks(
        reference_registry_hash=digest(
            sorted(
                (str(ref.id), ref.content_hash, str(ref.source_evidence_id)) for ref in references
            )
        ),
        reference_exclusion=refs,
        historical_cutoff=historical,
        input_match=matched,
        eligible=refs.status == matched.status == "pass"
        and historical.status in {"pass", "not_applicable"},
    )
