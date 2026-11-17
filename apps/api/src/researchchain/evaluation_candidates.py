"""Pin imported drafts or completed research attempts without invoking any provider."""

import json
from datetime import UTC, datetime
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

from researchchain.artifacts import EvidenceError, put_artifact, read_content
from researchchain.database import Database
from researchchain.evaluation_checks import check_inputs, digest, input_text, text_digest
from researchchain.evaluation_datasets import case_in, read_record, retry_record
from researchchain.evaluation_models import (
    EvaluationCandidate,
    EvaluationCandidateCreate,
    EvaluationDataset,
    EvaluationProvenance,
    ImportedEvaluationOutput,
    RecordedEvaluationOutput,
)
from researchchain.evidence import read_evidence, request_hash
from researchchain.research import read_attempts, read_manifest
from researchchain.research_models import ResearchResult
from researchchain.research_prompt import json_bytes
from researchchain.revisions import NotFoundError, read_revision


def render_result(result: ResearchResult) -> str:
    lines = [result.conclusion]
    for hypothesis in result.hypotheses:
        lines += [
            "",
            f"{hypothesis.id}: {hypothesis.statement}",
            f"Assessment: {hypothesis.assessment}",
        ]
        lines += ["Alternative: " + item for item in hypothesis.alternatives]
        lines += ["Falsifier: " + item for item in hypothesis.falsifiers]
        for citation in hypothesis.citations:
            lines += [
                f"Source [{citation.evidence_id}] ({citation.relation}; {citation.basis})",
                f"Location: {citation.locator}",
                f"Quote: {citation.quote}",
                f"Rationale: {citation.rationale}",
            ]
    lines += ["", "Revision: " + result.revision_summary]
    lines += ["Open question: " + item for item in result.unresolved_questions]
    for item in result.evidence_requests:
        lines += [f"Evidence needed: {item.question} — {item.source_needed}. {item.why}"]
    lines += ["Limitation: " + item for item in result.limitations]
    return "\n".join(lines)


def imported_source(
    conn: Connection[DictRow],
    source: ImportedEvaluationOutput,
) -> tuple[str, EvaluationProvenance, str | None]:
    if len(set(source.evidence_ids)) != len(source.evidence_ids):
        raise EvidenceError("Select each evidence snapshot only once.")
    artifact = put_artifact(conn, source.generation_input.encode(), "declared-generation-input.txt")
    provenance = EvaluationProvenance(
        verification="declared_import",
        origin=source.origin,
        model=source.model,
        workflow_version=source.workflow_version,
        workflow_hash=digest({"declared_version": source.workflow_version}),
        prompt_versions={"declared": source.prompt_version},
        prompt_hashes={"declared_input": text_digest(source.generation_input)},
        tool_version=source.tool_version,
        tool_config_hash=digest({"declared": source.tool_version}),
        evidence=[read_evidence(conn, key) for key in source.evidence_ids],
        generation_input_hash=artifact.id,
        renderer="plain-text-1",
    )
    return source.text, provenance, None


def recorded_source(
    conn: Connection[DictRow],
    source: RecordedEvaluationOutput,
) -> tuple[str, EvaluationProvenance, str]:
    row = conn.execute("SELECT * FROM runs WHERE id = %s", (source.run_id,)).fetchone()
    manifest = read_manifest(conn, source.run_id)
    if not row or not manifest:
        raise NotFoundError("Recorded research run not found.")
    attempts = read_attempts(conn, source.run_id)
    attempt = next((item for item in attempts if item.id == source.attempt_id), None)
    if not attempt:
        raise NotFoundError("Research attempt not found in this run.")
    if attempt.status != "completed" or not attempt.result or not attempt.input_artifact_id:
        raise EvidenceError("Only completed research attempts can become evaluation candidates.")
    # Include earlier requests too: a final draft can inherit exposure from prior steps.
    requests = [
        {
            "attempt_id": str(item.id),
            "request": json.loads(read_content(conn, item.input_artifact_id)),
        }
        for item in attempts
        if item.input_artifact_id and item.created_at <= attempt.created_at
    ]
    content = json_bytes({"requests": requests})
    if len(content) > 8_000_000:
        raise EvidenceError("Recorded evaluation inputs exceed the 8 MB packet budget.")
    artifact = put_artifact(conn, content, "recorded-generation-inputs.json")
    revision = read_revision(conn, row["revision_id"])
    provenance = EvaluationProvenance(
        verification="recorded_run",
        origin="model",
        model=attempt.returned_model or attempt.model,
        workflow_version=f"revision-{revision.number}/{manifest.compiler_version}",
        workflow_hash=revision.content_hash,
        prompt_versions=manifest.prompt_versions,
        prompt_hashes=manifest.prompt_hashes,
        tool_version=manifest.compiler_version,
        tool_config_hash=digest(manifest.tool_config),
        evidence=[read_evidence(conn, item.evidence_id) for item in manifest.evidence],
        generation_input_hash=artifact.id,
        run_id=source.run_id,
        attempt_id=source.attempt_id,
        renderer="research-text-1",
    )
    return render_result(attempt.result), provenance, str(row["brief"])


class EvaluationCandidates:
    def __init__(self, database: Database):
        self.database = database

    def create(self, request: EvaluationCandidateCreate) -> EvaluationCandidate:
        with self.database.connection() as conn, conn.transaction():
            existing = retry_record(
                conn, "evaluation_candidates", request.id, request, EvaluationCandidate
            )
            if existing:
                return existing
            case = case_in(
                read_record(conn, "evaluation_datasets", request.dataset_id, EvaluationDataset),
                request.case_id,
            )
            text, provenance, brief = (
                imported_source(conn, request.source)
                if isinstance(request.source, ImportedEvaluationOutput)
                else recorded_source(conn, request.source)
            )
            generation_input = read_content(conn, provenance.generation_input_hash).decode()
            checks = check_inputs(
                conn,
                case,
                provenance.evidence,
                input_text(conn, provenance.evidence, generation_input),
                brief=brief,
            )
            artifact = put_artifact(conn, text.encode(), f"evaluation-candidate-{request.id}.txt")
            record = EvaluationCandidate(
                id=request.id,
                dataset_id=request.dataset_id,
                case_id=request.case_id,
                label=request.label,
                text=text,
                content_hash=text_digest(text),
                artifact_id=artifact.id,
                provenance=provenance,
                checks=checks,
                created_at=datetime.now(UTC),
            )
            conn.execute(
                "INSERT INTO evaluation_candidates (id,dataset_id,case_id,request_hash,document) "
                "VALUES (%s,%s,%s,%s,%s)",
                (
                    record.id,
                    record.dataset_id,
                    record.case_id,
                    request_hash(request),
                    Jsonb(record.model_dump(mode="json")),
                ),
            )
            return record

    def list(self, dataset_id: UUID, case_id: str) -> list[EvaluationCandidate]:
        with self.database.connection() as conn:
            case_in(
                read_record(conn, "evaluation_datasets", dataset_id, EvaluationDataset), case_id
            )
            return [
                EvaluationCandidate.model_validate(row["document"])
                for row in conn.execute(
                    "SELECT document FROM evaluation_candidates "
                    "WHERE dataset_id = %s AND case_id = %s "
                    "ORDER BY created_at DESC,id DESC LIMIT 100",
                    (dataset_id, case_id),
                )
            ]
