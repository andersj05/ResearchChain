"""Synthetic fixtures exercise leakage and version boundaries, not real quality labels."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from pydantic import ValidationError

from researchchain.artifacts import EvidenceError
from researchchain.database import Database
from researchchain.evaluation_datasets import ANCHOR, EvaluationDatasets
from researchchain.evaluation_models import (
    EvaluationCase,
    EvaluationDatasetCreate,
    EvaluationReferenceCreate,
)
from researchchain.evidence import EvidenceStore
from researchchain.evidence_models import EvidenceCreate, EvidenceRecord
from researchchain.revisions import ConflictError, NotFoundError

REFERENCE = (
    "Synthetic reference answer: investors rebalance constrained portfolios when "
    "correlation regimes change, but this invented conclusion is not evidence."
)


def evidence(database: Database, **changes: Any) -> EvidenceRecord:
    return EvidenceStore(database).create(
        EvidenceCreate.model_validate(
            {
                "id": uuid4(),
                "title": "Synthetic source",
                "kind": "text",
                "rights": "owned",
                "text": "Synthetic primary source unrelated to the reference conclusion.",
                "published_date": datetime.now(UTC).date(),
                **changes,
            }
        )
    )


def case_for(source: EvidenceRecord, **changes: Any) -> EvaluationCase:
    return EvaluationCase.model_validate(
        {
            "id": "mechanism",
            "title": "Synthetic mechanism",
            "topic": "mechanism",
            "partition": "development",
            "track": "frozen_writing",
            "brief": "Assess the mechanism.",
            "evidence_ids": [source.id],
            **changes,
        }
    )


def dataset(database: Database, case: EvaluationCase) -> Any:
    return EvaluationDatasets(database).create(
        EvaluationDatasetCreate(
            id=uuid4(),
            title="Synthetic evaluation",
            cases=[case],
        )
    )


def reference(database: Database, **changes: Any) -> Any:
    return EvaluationDatasets(database).create_reference(
        EvaluationReferenceCreate.model_validate(
            {
                "id": uuid4(),
                "title": "Reference",
                "text": REFERENCE,
                "author": "Synthetic fixture",
                "origin": "synthetic",
                **changes,
            }
        )
    )


def test_versioned_datasets_are_immutable_and_retries_are_idempotent(database: Database) -> None:
    store = EvaluationDatasets(database)
    request = EvaluationDatasetCreate(
        id=uuid4(), title="Initial", cases=[case_for(evidence(database))]
    )
    with ThreadPoolExecutor(max_workers=3) as pool:
        records = list(pool.map(lambda _: store.create(request), range(3)))
    original = records[0]
    assert all(record == original for record in records)
    revised_request = request.model_copy(
        update={
            "id": uuid4(),
            "replaces_id": original.id,
            "title": "Revised",
        }
    )
    revised = store.create(revised_request)
    assert revised.version == 2 and revised.series_id == original.id
    assert store.get(original.id) == original
    assert store.create(revised_request) == revised
    with pytest.raises(ConflictError):
        store.create(revised_request.model_copy(update={"id": uuid4()}))
    with pytest.raises(ConflictError):
        store.create(request.model_copy(update={"title": "Overwrite"}))
    with database.connection() as conn, pytest.raises(psycopg.IntegrityError, match="immutable"):
        conn.execute("DELETE FROM evaluation_datasets WHERE id = %s", (original.id,))


def test_reference_is_separate_from_generation_packet(database: Database) -> None:
    baseline = reference(database)
    source = evidence(database)
    record = dataset(database, case_for(source, reference_ids=[baseline.id]))
    packet = EvaluationDatasets(database).inputs(record.id, "mechanism")
    assert packet.checks.eligible
    assert packet.checks.historical_cutoff.status == "not_applicable"
    assert REFERENCE not in packet.model_dump_json()
    assert str(baseline.id) not in packet.model_dump_json()
    assert "reference_ids" not in packet.model_dump()
    assert packet.evidence[0].content_hash == source.content_hash
    assert (
        packet.text_content[str(source.id)]
        == "Synthetic primary source unrelated to the reference conclusion."
    )
    assert len(packet.input_hash) == 64


@pytest.mark.parametrize("mode", ["copy", "brief", "lineage", "duplicate_original"])
def test_registered_reference_material_cannot_leave_as_generation_input(
    database: Database,
    mode: str,
) -> None:
    original = evidence(database, text="Original artifact associated with the reference.")
    reference(database, source_evidence_id=original.id)
    source = evidence(database)
    changes: dict[str, Any] = {}
    if mode == "copy":
        source = evidence(database, text="Quoted baseline: " + REFERENCE)
    elif mode == "brief":
        changes["brief"] = "Please imitate: " + REFERENCE
    elif mode == "lineage":
        source = evidence(database, parent_id=original.id, text="Derived reference interpretation.")
    else:
        source = evidence(database, text="Original artifact associated with the reference.")
    record = dataset(database, case_for(source, **changes))
    store = EvaluationDatasets(database)
    assert store.checks(record.id, "mechanism").reference_exclusion.status == "fail"
    with pytest.raises(EvidenceError, match="blocked"):
        store.inputs(record.id, "mechanism")


def test_unicode_reference_in_json_input_is_detected(database: Database) -> None:
    import json

    from researchchain.evaluation_checks import copied_reference

    baseline = reference(
        database, text="A synthetic café analysis with naïve assumptions and résumé caveats."
    )
    assert copied_reference(json.dumps({"source": baseline.text}, ensure_ascii=True), [baseline])


def test_anchor_reference_cannot_be_a_holdout(database: Database) -> None:
    baseline = reference(database, source_url=ANCHOR + "?test=1#reference")
    assert baseline.development_only
    with pytest.raises(EvidenceError, match="exemplars"):
        dataset(
            database, case_for(evidence(database), partition="holdout", reference_ids=[baseline.id])
        )


@pytest.mark.parametrize("overlap", ["topic", "snapshot", "duplicate_bytes", "reference"])
def test_development_holdout_overlap_is_rejected_across_datasets(
    database: Database,
    overlap: str,
) -> None:
    source = evidence(database)
    baseline = reference(database)
    dataset(database, case_for(source, reference_ids=[baseline.id]))
    other = evidence(database, text="Different primary source.")
    changes: dict[str, Any] = {"topic": "different", "partition": "holdout"}
    if overlap == "topic":
        changes["topic"] = "mechanism"
    elif overlap == "snapshot":
        other = source
    elif overlap == "duplicate_bytes":
        other = evidence(database)
    else:
        changes["reference_ids"] = [baseline.id]
    with pytest.raises(EvidenceError, match="separate"):
        dataset(database, case_for(other, **changes))


def test_same_topic_nonoverlapping_periods_are_separate(database: Database) -> None:
    dataset(
        database,
        case_for(evidence(database), period_start=date(2020, 1, 1), as_of_date=date(2020, 6, 1)),
    )
    later = dataset(
        database,
        case_for(
            evidence(database, text="Different time period."),
            partition="holdout",
            period_start=date(2021, 1, 1),
            as_of_date=date(2021, 6, 1),
        ),
    )
    assert later.cases[0].partition == "holdout"


@pytest.mark.parametrize(
    "metadata,expected",
    [
        ({"published_date": None}, "unknown"),
        ({"published_date": date(2040, 1, 1)}, "fail"),
        ({"as_of_date": date(2040, 1, 1)}, "fail"),
        ({}, "pass"),
    ],
)
def test_historical_metadata_gates(
    database: Database, metadata: dict[str, Any], expected: str
) -> None:
    today = datetime.now(UTC).date()
    record = dataset(
        database, case_for(evidence(database, **metadata), period_start=today, as_of_date=today)
    )
    check = EvaluationDatasets(database).checks(record.id, "mechanism")
    assert check.historical_cutoff.status == expected
    assert check.eligible == (expected == "pass")


def test_capture_time_cannot_be_backdated_by_declared_retrieval(database: Database) -> None:
    yesterday = datetime.now(UTC).date() - timedelta(days=1)
    source = evidence(database, published_date=yesterday, retrieved_at="2001-01-01T00:00:00Z")
    record = dataset(database, case_for(source, period_start=yesterday, as_of_date=yesterday))
    check = EvaluationDatasets(database).checks(record.id, "mechanism")
    assert check.historical_cutoff.status == "unknown" and not check.eligible
    with pytest.raises(EvidenceError):
        EvaluationDatasets(database).inputs(record.id, "mechanism")


def test_ancestor_dates_are_checked(database: Database) -> None:
    future = evidence(database, published_date=date(2040, 1, 1))
    source = evidence(database, parent_id=future.id, text="Derived copy with current publication.")
    today = datetime.now(UTC).date()
    record = dataset(database, case_for(source, period_start=today, as_of_date=today))
    assert (
        EvaluationDatasets(database).checks(record.id, "mechanism").historical_cutoff.status
        == "fail"
    )


def test_invalid_case_ranges_and_duplicate_ids_are_rejected(database: Database) -> None:
    source = evidence(database)
    with pytest.raises(ValidationError):
        case_for(source, as_of_date=date(2020, 1, 1))
    with pytest.raises(ValidationError):
        case_for(source, evidence_ids=[source.id, source.id])
    with pytest.raises(EvidenceError, match="future"):
        dataset(
            database, case_for(source, period_start=date(2040, 1, 1), as_of_date=date(2040, 2, 1))
        )


def test_missing_reference_in_later_case_returns_not_found(database: Database) -> None:
    source = evidence(database)
    request = EvaluationDatasetCreate(
        id=uuid4(),
        title="Multiple cases",
        cases=[
            case_for(source),
            case_for(source, id="other", reference_ids=[uuid4()]),
        ],
    )
    with pytest.raises(NotFoundError, match="reference"):
        EvaluationDatasets(database).create(request)
