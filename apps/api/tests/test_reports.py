"""Synthetic editorial fixtures; no real review decisions or provider calls."""

import base64
import io
import json
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from uuid import uuid4
from zipfile import ZipFile

import psycopg
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from test_evaluation_datasets import evidence
from test_research_runtime import setup_run

from researchchain.artifacts import ArtifactStore, EvidenceError
from researchchain.database import Database
from researchchain.evidence import EvidenceStore
from researchchain.evidence_models import EvidenceCreate
from researchchain.report_models import (
    ReportCreate,
    ReportFeedbackCreate,
    ReportSave,
    ReportSection,
    ReportSummary,
    StyleGuideCreate,
)
from researchchain.reports import Reports, StyleGuides
from researchchain.revisions import ConflictError, NotFoundError

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII="
)


def style_request(**changes: Any) -> StyleGuideCreate:
    return StyleGuideCreate.model_validate(
        {
            "id": uuid4(),
            "title": "Synthetic editorial guide",
            "analytical_structure": "Question, mechanism, alternatives, falsifiers, conclusion.",
            "voice": "Concrete, direct prose; distinguish evidence from interpretation.",
            "source_discipline": "State original dates and units; preserve numerical uncertainty.",
            "scenarios": "Conditional statements are not forecasts.",
            "examples": [
                {
                    "kind": "structure",
                    "principle": "Include alternatives.",
                    "example": "Mechanism A could explain X; mechanism B remains possible.",
                },
                {
                    "kind": "voice",
                    "principle": "State uncertainty plainly.",
                    "example": "The source does not establish which mechanism dominates.",
                },
            ],
            "change_note": "Synthetic test guide.",
            **changes,
        }
    )


def seeded(database: Database) -> Any:
    guides = StyleGuides(database)
    guide = guides.create(style_request())
    store, request, provider = setup_run(database)
    source = evidence(database, text="An exact synthetic quotation. A 😀 observation.")
    snapshot = store.start(request.model_copy(update={"evidence_ids": [source.id]}))
    create = ReportCreate(
        id=uuid4(),
        title="Synthetic report",
        run_id=snapshot.id,
        attempt_id=snapshot.model_attempts[0].id,
        style_guide_id=guide.id,
    )
    record = Reports(database).create(create)
    assert len(provider.calls) == 1
    return record, guide, source, create


def revision_request(record: Any, **changes: Any) -> ReportSave:
    sections = [s.model_dump(mode="json") for s in record.sections]
    sections[0]["body"] = "A 😀 revised interpretation, with explicit uncertainty."
    return ReportSave.model_validate(
        {
            "id": uuid4(),
            "base_revision_id": record.id,
            "title": record.title,
            "style_guide_id": record.style_guide_id,
            "evidence_ids": [s.id for s in record.sources],
            "sections": sections,
            "change_note": "Clarified the interpretation.",
            **changes,
        }
    )


def feedback(record: Any, **changes: Any) -> ReportFeedbackCreate:
    return ReportFeedbackCreate.model_validate(
        {
            "id": uuid4(),
            "report_hash": record.content_hash,
            "kind": "comment",
            "reason": "Synthetic reviewer notes the uncertainty.",
            **changes,
        }
    )


def test_seed_pins_research_without_new_inference(database: Database) -> None:
    record, guide, source, create = seeded(database)
    store = Reports(database)
    assert store.create(create) == record
    assert record.author == "research_seed"
    assert record.provenance.attempt.status == "completed"
    assert record.provenance.manifest.prompt_hashes
    assert record.provenance.attempt.input_artifact_id
    assert record.provenance.attempt.response_artifact_id
    assert record.sources[0] == source
    assert store.get(record.id).review_status == "unreviewed"
    assert store.get(record.id).style_guide == guide
    with pytest.raises(ConflictError):
        store.create(create.model_copy(update={"title": "Different request"}))
    with pytest.raises(NotFoundError):
        store.create(create.model_copy(update={"id": uuid4(), "attempt_id": uuid4()}))


def test_concurrent_saves_retries_and_old_revision_integrity(database: Database) -> None:
    record, _, _, _ = seeded(database)
    store = Reports(database)
    request = revision_request(record)
    with ThreadPoolExecutor(max_workers=3) as pool:
        copies = list(pool.map(lambda _: store.save(request), range(3)))
    saved = copies[0]
    assert all(item == saved for item in copies)
    assert saved.version == 2 and saved.author == "human"
    assert saved.provenance == record.provenance
    assert saved.edits[0].before_hash == record.section_hashes[record.sections[0].id]
    assert saved.edits[0].after_hash == saved.section_hashes[record.sections[0].id]
    assert store.get(record.id).revision == record
    assert store.get(record.id).current_revision_id == saved.id
    with pytest.raises(ConflictError, match="newer revision"):
        store.save(request.model_copy(update={"id": uuid4()}))
    with pytest.raises(ConflictError, match="different inputs"):
        store.save(request.model_copy(update={"change_note": "Changed receipt"}))
    history = store.list(record.id)
    fields = set(ReportSummary.model_fields)
    assert [item.model_dump() for item in history] == [
        revision.model_dump(include=fields) for revision in (saved, record)
    ]
    assert store.list() == [history[0]]
    assert store.list(search="clarified the interpretation") == [history[0]]
    with pytest.raises(NotFoundError, match="Editorial record not found"):
        store.list(uuid4())


def test_distinct_concurrent_edits_have_one_winner(database: Database) -> None:
    record, _, _, _ = seeded(database)
    requests = [revision_request(record, title=f"Draft {i}") for i in range(2)]

    def save(item: ReportSave) -> str:
        try:
            Reports(database).save(item)
            return "saved"
        except ConflictError:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(save, requests)) == ["conflict", "saved"]


def test_styles_are_versioned_and_pinning_is_explicit(database: Database) -> None:
    record, original, _, _ = seeded(database)
    guides = StyleGuides(database)
    request = style_request(replaces_id=original.id, title="Updated style")
    changed = guides.create(request)
    assert changed.version == 2 and changed.series_id == original.series_id
    assert guides.create(request) == changed
    with pytest.raises(ConflictError):
        guides.create(request.model_copy(update={"id": uuid4()}))
    store = Reports(database)
    assert store.get(record.id).style_guide == original
    saved = store.save(revision_request(record, style_guide_id=changed.id))
    assert store.get(saved.id).style_guide == changed
    assert store.get(record.id).style_guide == original
    with pytest.raises(ValidationError, match="both analytical"):
        style_request(
            examples=[
                {"kind": "voice", "principle": "One", "example": "A"},
                {"kind": "voice", "principle": "Two", "example": "B"},
            ]
        )


def test_feedback_is_immutable_unicode_bound_and_not_inherited(database: Database) -> None:
    record, _, _, _ = seeded(database)
    store = Reports(database)
    saved = store.save(revision_request(record))
    section = saved.sections[0]
    request = feedback(
        saved,
        section_id=section.id,
        section_hash=saved.section_hashes[section.id],
        anchor={"start": 2, "end": 3, "quote": "😀"},
    )
    comment = store.feedback(saved.id, request)
    assert comment.training_consent is False and comment.actor == "human"
    assert store.feedback(saved.id, request) == comment
    with pytest.raises(EvidenceError, match="Unicode"):
        store.feedback(
            saved.id,
            request.model_copy(
                update={"id": uuid4(), "anchor": request.anchor.model_copy(update={"end": 4})}
            ),
        )
    with pytest.raises(ConflictError):
        store.feedback(
            saved.id, request.model_copy(update={"id": uuid4(), "section_hash": "0" * 64})
        )
    with pytest.raises(ConflictError):
        store.feedback(record.id, request)
    decision = feedback(saved, kind="decision", value="accept")
    store.feedback(saved.id, decision)
    assert store.get(saved.id).review_status == "accepted"
    third = store.save(revision_request(saved, title="Edited title"))
    assert store.get(third.id).review_status == "unreviewed"
    assert store.get(third.id).feedback == []
    assert store.get(saved.id).review_status == "accepted"
    store.feedback(saved.id, feedback(saved, kind="decision", value="reject"))
    assert store.get(saved.id).review_status == "rejected"


def test_preferences_pin_both_versions_and_section_decision_is_local(database: Database) -> None:
    record, _, _, _ = seeded(database)
    store = Reports(database)
    with pytest.raises(EvidenceError, match="predecessor"):
        store.feedback(record.id, feedback(record, kind="preference", value="prefer_current"))
    saved = store.save(revision_request(record))
    section = saved.sections[0]
    item = store.feedback(
        saved.id,
        feedback(
            saved,
            kind="preference",
            value="prefer_previous",
            section_id=section.id,
            section_hash=saved.section_hashes[section.id],
        ),
    )
    assert item.compared_revision_id == record.id
    assert item.compared_hash == record.section_hashes[section.id]
    store.feedback(
        saved.id,
        feedback(
            saved,
            kind="decision",
            value="accept",
            section_id=section.id,
            section_hash=saved.section_hashes[section.id],
        ),
    )
    assert store.get(saved.id).review_status == "unreviewed"


def test_citations_and_charts_must_match_captured_source(database: Database) -> None:
    record, _, source, _ = seeded(database)
    store = Reports(database)
    request = revision_request(record)
    section = request.sections[0].model_dump(mode="json")
    section["kind"] = "fact"
    citation = {
        "evidence_id": str(source.id),
        "relation": "supports",
        "basis": "source_text",
        "locator": "Sentence 1",
        "quote": "An exact synthetic quotation.",
        "rationale": "Synthetic quotation supports the example only.",
    }
    section["citations"] = [citation]
    valid = revision_request(record, sections=[section])
    saved = store.save(valid)
    assert saved.sections[0].kind == "fact"
    for changes in [
        {"quote": "A fabricated quote."},
        {"basis": "numeric_source"},
        {"evidence_id": str(uuid4())},
    ]:
        edited = {**section, "citations": [{**citation, **changes}]}
        with pytest.raises(EvidenceError):
            store.save(revision_request(saved, sections=[edited]))
    with pytest.raises(EvidenceError, match="Charts"):
        store.save(revision_request(saved, sections=[{**section, "chart_ids": [str(source.id)]}]))
    with pytest.raises(EvidenceError, match="Keep existing"):
        store.save(revision_request(saved, evidence_ids=[]))


def test_numeric_derivatives_cannot_be_relabelled_original(database: Database) -> None:
    record, _, source, _ = seeded(database)
    image = ArtifactStore(database).put(PNG, "source.png")
    parent = EvidenceStore(database).create(
        EvidenceCreate(
            id=uuid4(),
            title="Screenshot",
            kind="image",
            representation="chart_screenshot",
            rights="owned",
            artifact_id=image.id,
        )
    )
    derived = evidence(database, parent_id=parent.id, text="An interpreted value.")
    citation = {
        "evidence_id": str(derived.id),
        "relation": "supports",
        "basis": "source_text",
        "locator": "Line 1",
        "quote": "An interpreted value.",
        "rationale": "Interpretation.",
    }
    section = record.sections[0].model_dump(mode="json")
    section["citations"] = [citation]
    request = revision_request(record, evidence_ids=[source.id, derived.id], sections=[section])
    with pytest.raises(EvidenceError, match="representation"):
        Reports(database).save(request)
    citation["basis"] = "estimate"
    request = revision_request(record, evidence_ids=[source.id, derived.id], sections=[section])
    assert Reports(database).save(request).sections[0].citations[0].basis == "estimate"


def test_draft_sources_read_exact_bounded_records_and_authoritative_bases(
    client: TestClient, database: Database
) -> None:
    image = ArtifactStore(database).put(PNG, "draft-source.png")
    chart = EvidenceStore(database).create(
        EvidenceCreate(
            id=uuid4(),
            title="Synthetic chart",
            kind="image",
            representation="chart_screenshot",
            rights="owned",
            artifact_id=image.id,
        )
    )
    derived = evidence(database, parent_id=chart.id, text="The interpretation is synthetic.")
    endpoint = "/api/reports/draft-sources"
    ids = [derived.id, uuid4(), chart.id, derived.id]
    with TestClient(client.app, base_url=str(client.base_url)) as anonymous:
        assert anonymous.get(endpoint, params={"evidence_id": [str(derived.id)]}).status_code == 401

    response = client.get(endpoint, params={"evidence_id": [str(key) for key in ids]})
    assert response.status_code == 200
    assert response.json() == {
        "sources": [
            derived.model_dump(mode="json", by_alias=True),
            chart.model_dump(mode="json", by_alias=True),
        ],
        "source_bases": {str(derived.id): "estimate", str(chart.id): "image_interpretation"},
    }
    assert client.get(endpoint).status_code == 422
    assert client.get(endpoint, params={"evidence_id": [str(derived.id)] * 101}).status_code == 422


def test_noop_and_invalid_fact_sections_rejected(database: Database) -> None:
    record, _, _, _ = seeded(database)
    with pytest.raises(EvidenceError, match="Change the report"):
        Reports(database).save(revision_request(record, sections=record.sections))
    with pytest.raises(ValidationError, match="supporting evidence"):
        ReportSection(id=uuid4(), heading="Unsupported fact", body="Claim", kind="fact")
    with pytest.raises(ValidationError):
        feedback(record, training_consent=True)
    with pytest.raises(ValidationError):
        feedback(record, kind="decision", value=None)
    with pytest.raises(ValidationError):
        revision_request(record, sections=[record.sections[0], record.sections[0]])


def test_database_prevents_report_style_and_feedback_rewrites(database: Database) -> None:
    record, guide, _, _ = seeded(database)
    note = Reports(database).feedback(record.id, feedback(record))
    from psycopg import sql

    for table, key in [
        ("report_revisions", record.id),
        ("style_guides", guide.id),
        ("report_feedback", note.id),
    ]:
        with (
            database.connection() as conn,
            pytest.raises(psycopg.IntegrityError, match="immutable"),
        ):
            conn.execute(
                sql.SQL("DELETE FROM {} WHERE id = %s").format(sql.Identifier(table)), (key,)
            )


def test_report_api_and_safe_offline_export(client: TestClient, database: Database) -> None:
    record, _, source, _ = seeded(database)
    artifact = ArtifactStore(database).put(PNG, "original.png")
    chart = EvidenceStore(database).create(
        EvidenceCreate(
            id=uuid4(),
            title='Chart <script>alert("source")</script>',
            kind="image",
            rights="owned",
            artifact_id=artifact.id,
            representation="chart_screenshot",
        )
    )
    section = record.sections[0].model_dump(mode="json")
    section.update(body='A 😀 draft <script>alert("report")</script>', chart_ids=[str(chart.id)])
    request = revision_request(record, sections=[section], evidence_ids=[source.id, chart.id])
    response = client.post("/api/reports/revisions", json=request.model_dump(mode="json"))
    assert response.status_code == 201
    saved_id = response.json()["id"]
    exported = client.get(f"/api/reports/{saved_id}/export")
    assert exported.status_code == 200
    assert exported.headers["content-type"] == "application/zip"
    assert set(exported.headers["cache-control"].split(", ")) == {"no-store", "private"}
    schema = client.get("/api/openapi.json").json()
    content = schema["paths"]["/api/reports/{key}/export"]["get"]["responses"]["200"]["content"]
    assert set(content) == {"application/zip"}
    assert content["application/zip"]["schema"]["format"] == "binary"
    with ZipFile(io.BytesIO(exported.content)) as archive:
        html = archive.read("index.html").decode("utf-8")
        assert "<script>" not in html and "&lt;script&gt;" in html
        assert "unreviewed" in html and "Not published" in html
        assert "😀" in html
        assert "Content-Security-Policy" in html
        bundle = json.loads(archive.read("report.json"))
        assert bundle["report"]["revision"]["provenance"]["attempt"]["id"] == str(
            record.provenance.attempt.id
        )
        path = f"originals/{artifact.id.removeprefix('sha256:')}.png"
        assert archive.read(path) == PNG and path in html
        assert all(".." not in name and not name.startswith("/") for name in archive.namelist())
    assert client.get(f"/api/reports/{saved_id}/history").json()[0]["id"] == saved_id
    assert client.get("/api/reports").json()[0]["id"] == saved_id
    assert client.get("/api/style-guides").status_code == 200
    assert client.get(f"/api/reports/{uuid4()}").status_code == 404
