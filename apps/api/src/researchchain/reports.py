"""Versioned human editing of recorded research, without new provider calls."""

import hashlib
from typing import Any
from uuid import UUID, uuid4

from psycopg.types.json import Jsonb
from pydantic import ValidationError

from researchchain.artifacts import EvidenceError
from researchchain.database import Database
from researchchain.evidence import read_evidence, request_hash
from researchchain.report_models import (
    ReportCreate,
    ReportEdit,
    ReportFeedback,
    ReportFeedbackCreate,
    ReportProvenance,
    ReportRevision,
    ReportSave,
    ReportSection,
    ReportSummary,
    ReportView,
    StyleGuide,
    StyleGuideCreate,
)
from researchchain.report_records import (
    insert_version,
    now,
    read_record,
    require_head,
    retry_record,
)
from researchchain.report_sources import source_basis, validate_sources
from researchchain.research import read_attempts, read_manifest
from researchchain.research_models import ResearchResult
from researchchain.research_prompt import json_bytes
from researchchain.revisions import ConflictError, NotFoundError, read_revision


def digest(value: Any) -> str:
    return hashlib.sha256(json_bytes(value)).hexdigest()


def section_edits(previous: list[ReportSection], current: list[ReportSection]) -> list[ReportEdit]:
    before = {item.id: (i, request_hash(item)) for i, item in enumerate(previous)}
    after = {item.id: (i, request_hash(item)) for i, item in enumerate(current)}
    edits = []
    for key in dict.fromkeys([*before, *after]):
        old = before.get(key)
        new = after.get(key)
        if old == new:
            continue
        edits.append(
            ReportEdit(
                section_id=key,
                change="added"
                if old is None
                else "removed"
                if new is None
                else "edited"
                if old[1] != new[1]
                else "moved",
                before_hash=old[1] if old else None,
                after_hash=new[1] if new else None,
            )
        )
    return edits


def seed_sections(result: ResearchResult) -> list[ReportSection]:
    sections = [ReportSection(id=uuid4(), heading="Research conclusion", body=result.conclusion)]
    for hypothesis in result.hypotheses:
        body = "\n\n".join(
            [
                hypothesis.statement,
                f"Research assessment: {hypothesis.assessment}.",
                "Alternative explanations\n"
                + "\n".join(f"- {text}" for text in hypothesis.alternatives),
                "What would change the conclusion\n"
                + "\n".join(f"- {text}" for text in hypothesis.falsifiers),
            ]
        )
        sections.append(
            ReportSection(
                id=uuid4(),
                heading=f"{hypothesis.id}: Mechanism and alternatives",
                body=body,
                kind="scenario" if hypothesis.assessment == "untested" else "interpretation",
                citations=hypothesis.citations,
                chart_ids=list(
                    dict.fromkeys(
                        c.evidence_id
                        for c in hypothesis.citations
                        if c.basis == "image_interpretation"
                    )
                ),
            )
        )
    lines = [*result.limitations]
    lines += ["Open question: " + text for text in result.unresolved_questions]
    lines += [
        f"Evidence needed: {item.question} — {item.source_needed}. {item.why}"
        for item in result.evidence_requests
    ]
    # The research contract can contain more than one section's maximum text.
    chunks: list[str] = []
    for line in lines:
        if not chunks or len(chunks[-1]) + len(line) + 2 > 30000:
            chunks.append(line)
        else:
            chunks[-1] += "\n\n" + line
    sections += [
        ReportSection(id=uuid4(), heading=f"Limitations and open questions {i + 1}", body=text)
        for i, text in enumerate(chunks)
    ]
    return sections


class StyleGuides:
    def __init__(self, database: Database):
        self.database = database

    def create(self, request: StyleGuideCreate) -> StyleGuide:
        with self.database.connection() as conn, conn.transaction():
            existing = retry_record(conn, "style_guides", request.id, request, StyleGuide)
            if existing:
                return existing
            previous = (
                read_record(conn, "style_guides", request.replaces_id, StyleGuide)
                if request.replaces_id
                else None
            )
            if previous:
                require_head(conn, "style_guides", previous.id)
            record = StyleGuide(
                **request.model_dump(),
                series_id=previous.series_id if previous else request.id,
                version=previous.version + 1 if previous else 1,
                content_hash=digest(
                    request.model_dump(mode="json", exclude={"id", "replaces_id", "change_note"})
                ),
                created_at=now(),
            )
            insert_version(conn, "style_guides", record, request)
            return record

    def get(self, key: UUID) -> StyleGuide:
        with self.database.connection() as conn:
            return read_record(conn, "style_guides", key, StyleGuide)

    def list(self) -> list[StyleGuide]:
        with self.database.connection() as conn:
            return [
                StyleGuide.model_validate(row["document"])
                for row in conn.execute(
                    "SELECT document FROM style_guides ORDER BY created_at DESC,id DESC LIMIT 100"
                )
            ]


class Reports:
    def __init__(self, database: Database):
        self.database = database

    def create(self, request: ReportCreate) -> ReportRevision:
        with self.database.connection() as conn, conn.transaction():
            existing = retry_record(conn, "report_revisions", request.id, request, ReportRevision)
            if existing:
                return existing
            read_record(conn, "style_guides", request.style_guide_id, StyleGuide)
            row = conn.execute(
                "SELECT brief, revision_id FROM runs WHERE id = %s", (request.run_id,)
            ).fetchone()
            manifest = read_manifest(conn, request.run_id)
            if not row or not manifest:
                raise NotFoundError("Recorded research run not found.")
            attempt = next(
                (
                    item
                    for item in read_attempts(conn, request.run_id)
                    if item.id == request.attempt_id
                ),
                None,
            )
            if not attempt:
                raise NotFoundError("Research attempt not found in this run.")
            if (
                attempt.status != "completed"
                or not attempt.result
                or not attempt.input_artifact_id
                or not attempt.response_artifact_id
            ):
                raise EvidenceError(
                    "Choose a completed research attempt with recorded input and output."
                )
            sources = [read_evidence(conn, item.evidence_id) for item in manifest.evidence]
            sections = seed_sections(attempt.result)
            # Keep the same size limits on the server-created draft as on later edits.
            try:
                ReportSave(
                    id=uuid4(),
                    base_revision_id=request.id,
                    title=request.title,
                    style_guide_id=request.style_guide_id,
                    evidence_ids=[s.id for s in sources],
                    sections=sections,
                    change_note="Seed from recorded research.",
                )
            except ValidationError as error:
                raise EvidenceError(
                    "The recorded result exceeds the report size limits."
                ) from error
            validate_sources(conn, sections, sources)
            provenance = ReportProvenance(
                run_id=request.run_id,
                brief=row["brief"],
                workflow_hash=read_revision(conn, row["revision_id"]).content_hash,
                manifest=manifest,
                attempt=attempt,
            )
            record = ReportRevision(
                id=request.id,
                series_id=request.id,
                version=1,
                replaces_id=None,
                title=request.title,
                style_guide_id=request.style_guide_id,
                sections=sections,
                sources=sources,
                provenance=provenance,
                content_hash=digest(
                    {
                        "title": request.title,
                        "style": str(request.style_guide_id),
                        "sections": [s.model_dump(mode="json") for s in sections],
                        "sources": [s.model_dump(mode="json") for s in sources],
                        "provenance": provenance.model_dump(mode="json"),
                    }
                ),
                section_hashes={s.id: request_hash(s) for s in sections},
                edits=[],
                author="research_seed",
                change_note="Seeded from a recorded model result; requires editorial review.",
                created_at=now(),
            )
            insert_version(conn, "report_revisions", record, request)
            return record

    def save(self, request: ReportSave) -> ReportRevision:
        with self.database.connection() as conn, conn.transaction():
            existing = retry_record(conn, "report_revisions", request.id, request, ReportRevision)
            if existing:
                return existing
            previous = read_record(
                conn, "report_revisions", request.base_revision_id, ReportRevision
            )
            require_head(conn, "report_revisions", previous.id)
            read_record(conn, "style_guides", request.style_guide_id, StyleGuide)
            if not {s.id for s in previous.sources} <= set(request.evidence_ids):
                raise EvidenceError("Keep existing source snapshots; new sources may be added.")
            sources = [read_evidence(conn, key) for key in request.evidence_ids]
            validate_sources(conn, request.sections, sources)
            record = ReportRevision(
                id=request.id,
                series_id=previous.series_id,
                version=previous.version + 1,
                replaces_id=previous.id,
                title=request.title,
                style_guide_id=request.style_guide_id,
                sections=request.sections,
                sources=sources,
                provenance=previous.provenance,
                content_hash=digest(
                    {
                        "title": request.title,
                        "style": str(request.style_guide_id),
                        "sections": [s.model_dump(mode="json") for s in request.sections],
                        "sources": [s.model_dump(mode="json") for s in sources],
                        "provenance": previous.provenance.model_dump(mode="json"),
                    }
                ),
                section_hashes={s.id: request_hash(s) for s in request.sections},
                edits=section_edits(previous.sections, request.sections),
                author="human",
                change_note=request.change_note,
                created_at=now(),
            )
            if record.content_hash == previous.content_hash:
                raise EvidenceError(
                    "Change the report content, sources or pinned style guide before saving."
                )
            insert_version(conn, "report_revisions", record, request)
            return record

    def get(self, key: UUID) -> ReportView:
        with self.database.connection() as conn:
            record = read_record(conn, "report_revisions", key, ReportRevision)
            head = conn.execute(
                "SELECT id FROM report_revisions WHERE series_id = %s "
                "ORDER BY version DESC LIMIT 1",
                (record.series_id,),
            ).fetchone()
            assert head
            feedback = [
                ReportFeedback.model_validate(row["document"])
                for row in conn.execute(
                    "SELECT document FROM report_feedback WHERE revision_id = %s ORDER BY sequence",
                    (key,),
                )
            ]
            decision = next(
                (f for f in reversed(feedback) if f.kind == "decision" and f.section_id is None),
                None,
            )
            return ReportView(
                revision=record,
                current_revision_id=head["id"],
                style_guide=read_record(conn, "style_guides", record.style_guide_id, StyleGuide),
                source_bases={source.id: source_basis(conn, source) for source in record.sources},
                feedback=feedback,
                review_status="accepted"
                if decision and decision.value == "accept"
                else "rejected"
                if decision
                else "unreviewed",
            )

    def list(self, revision_id: UUID | None = None) -> list[ReportSummary]:
        with self.database.connection() as conn:
            if revision_id:
                record = read_record(conn, "report_revisions", revision_id, ReportRevision)
                rows = conn.execute(
                    "SELECT document FROM report_revisions WHERE series_id = %s "
                    "ORDER BY version DESC LIMIT 100",
                    (record.series_id,),
                )
            else:
                rows = conn.execute(
                    "SELECT document FROM report_revisions r WHERE NOT EXISTS "
                    "(SELECT 1 FROM report_revisions n WHERE n.replaces_id = r.id) "
                    "ORDER BY created_at DESC,id DESC LIMIT 100"
                )
            return [
                ReportSummary(
                    id=item.id,
                    series_id=item.series_id,
                    version=item.version,
                    title=item.title,
                    author=item.author,
                    created_at=item.created_at,
                    change_note=item.change_note,
                )
                for row in rows
                if (item := ReportRevision.model_validate(row["document"]))
            ]

    def feedback(self, key: UUID, request: ReportFeedbackCreate) -> ReportFeedback:
        with self.database.connection() as conn, conn.transaction():
            existing = retry_record(conn, "report_feedback", request.id, request, ReportFeedback)
            if existing:
                if existing.revision_id != key:
                    raise ConflictError("This feedback ID belongs to a different report revision.")
                return existing
            record = read_record(conn, "report_revisions", key, ReportRevision)
            if request.report_hash != record.content_hash:
                raise ConflictError("The feedback does not match this report's exact content.")
            section = next((s for s in record.sections if s.id == request.section_id), None)
            if request.section_id:
                if not section or record.section_hashes[section.id] != request.section_hash:
                    raise ConflictError("The selected section or its content hash does not match.")
            if request.anchor:
                anchor = request.anchor
                if (
                    not section
                    or not 0 <= anchor.start < anchor.end <= len(section.body)
                    or section.body[anchor.start : anchor.end] != anchor.quote
                ):
                    raise EvidenceError(
                        "The anchor must match an exact Unicode code-point span "
                        "in the saved section."
                    )
            compared_id = None
            compared_hash = None
            if request.kind == "preference":
                if not record.replaces_id:
                    raise EvidenceError(
                        "Preferences compare this revision with its immediate predecessor."
                    )
                previous = read_record(conn, "report_revisions", record.replaces_id, ReportRevision)
                compared_id = previous.id
                compared_hash = previous.content_hash
                if request.section_id:
                    if request.section_id not in previous.section_hashes:
                        raise EvidenceError("This section did not exist in the preceding revision.")
                    compared_hash = previous.section_hashes[request.section_id]
            # Serialize decisions for an unambiguous, append-only review history.
            conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"report-feedback:{key}",)
            )
            count = conn.execute(
                "SELECT count(*) AS count FROM report_feedback WHERE revision_id = %s", (key,)
            ).fetchone()
            if count and count["count"] >= 1000:
                raise EvidenceError("This revision has reached its 1,000-feedback limit.")
            record_feedback = ReportFeedback(
                **request.model_dump(),
                revision_id=key,
                compared_revision_id=compared_id,
                compared_hash=compared_hash,
                created_at=now(),
            )
            conn.execute(
                "INSERT INTO report_feedback (id,revision_id,request_hash,document) "
                "VALUES (%s,%s,%s,%s)",
                (
                    request.id,
                    key,
                    request_hash(request),
                    Jsonb(record_feedback.model_dump(mode="json")),
                ),
            )
            return record_feedback
