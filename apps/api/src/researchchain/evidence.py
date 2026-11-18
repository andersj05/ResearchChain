"""Append-only provenance and claims. Captured sources never become instructions."""

import hashlib
import json
from datetime import UTC, datetime
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

from researchchain.artifacts import (
    EvidenceError,
    numeric_preview,
    preview_content,
    put_artifact,
    read_artifact,
    read_content,
)
from researchchain.database import Database
from researchchain.evidence_models import (
    ClaimCreate,
    ClaimPage,
    ClaimRecord,
    ContentPreview,
    EvidenceCreate,
    EvidencePage,
    EvidenceRecord,
)
from researchchain.graph import StrictModel
from researchchain.revisions import ConflictError, NotFoundError


def request_hash(request: StrictModel) -> str:
    canonical = json.dumps(request.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def read_evidence(conn: Connection[DictRow], evidence_id: UUID) -> EvidenceRecord:
    row = conn.execute(
        "SELECT document FROM evidence_records WHERE id = %s", (evidence_id,)
    ).fetchone()
    if row is None:
        raise NotFoundError("Evidence record not found.")
    return EvidenceRecord.model_validate(row["document"])


def read_claim(conn: Connection[DictRow], claim_id: UUID) -> ClaimRecord:
    row = conn.execute("SELECT document FROM claims WHERE id = %s", (claim_id,)).fetchone()
    if row is None:
        raise NotFoundError("Claim not found.")
    return ClaimRecord.model_validate(row["document"])


def validate_lineage(conn: Connection[DictRow], request: EvidenceCreate) -> None:
    if request.replaces_id:
        read_evidence(conn, request.replaces_id)
    if request.parent_id:
        parent = read_evidence(conn, request.parent_id)
        if request.representation in ("ocr_interpretation", "digitized_estimate"):
            if parent.artifact is None:
                raise EvidenceError(
                    "Interpretations and estimates need a captured parent original."
                )
    if request.representation == "numeric_data":
        # Traverse derivations AND corrections so removing a parent field in a
        # later version cannot turn an earlier estimate into source data.
        ancestors = [item for item in (request.parent_id, request.replaces_id) if item]
        row = conn.execute(
            "WITH RECURSIVE lineage AS ("
            " SELECT id, parent_id, replaces_id, document FROM evidence_records WHERE id = ANY(%s)"
            " UNION SELECT e.id, e.parent_id, e.replaces_id, e.document FROM evidence_records e"
            " JOIN lineage l ON e.id = l.parent_id OR e.id = l.replaces_id)"
            " SELECT 1 FROM lineage WHERE document->>'representation' IN"
            " ('chart_screenshot', 'ocr_interpretation', 'digitized_estimate') LIMIT 1",
            (ancestors,),
        ).fetchone()
        if row:
            raise EvidenceError(
                "Chart-derived values must remain digitized estimates, not source numeric data."
            )


class EvidenceStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    def create(self, request: EvidenceCreate) -> EvidenceRecord:
        digest = request_hash(request)
        with self.database.connection() as conn, conn.transaction():
            conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"evidence:{request.id}",)
            )
            existing = conn.execute(
                "SELECT request_hash, document FROM evidence_records WHERE id = %s", (request.id,)
            ).fetchone()
            if existing:
                if existing["request_hash"] != digest:
                    raise ConflictError("This evidence ID already belongs to different inputs.")
                return EvidenceRecord.model_validate(existing["document"])
            validate_lineage(conn, request)
            artifact = read_artifact(conn, request.artifact_id) if request.artifact_id else None
            if request.text:
                suffix = request.table_format or "txt"
                artifact = put_artifact(
                    conn, request.text.encode(), f"source-{request.id}.{suffix}"
                )
            content = read_content(conn, artifact.id) if artifact else b""
            preview = preview_content(content, artifact.media_type) if artifact else None
            if artifact and request.representation == "chart_screenshot":
                if artifact.media_type not in ("image/png", "image/jpeg", "image/webp"):
                    raise EvidenceError("Chart screenshots require a PNG, JPEG, or WebP original.")
            if artifact and request.representation == "ocr_interpretation":
                if not artifact.media_type.startswith("text/"):
                    raise EvidenceError("OCR interpretations require supplied UTF-8 text.")
            if artifact and request.representation in ("numeric_data", "digitized_estimate"):
                assert request.table_format is not None
                preview = numeric_preview(content, request.table_format)
            record = EvidenceRecord(
                **request.model_dump(exclude={"artifact_id", "text"}),
                artifact=artifact,
                content_hash=artifact.id if artifact else None,
                created_at=datetime.now(UTC),
                captured_at=artifact.created_at if artifact else None,
                capture_method="user_text"
                if request.text
                else "user_upload"
                if artifact
                else "reference",
                preview=preview or ContentPreview(),
            )
            conn.execute(
                "INSERT INTO evidence_records"
                " (id, request_hash, document, artifact_id, parent_id, replaces_id, created_at)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (
                    record.id,
                    digest,
                    Jsonb(record.model_dump(mode="json")),
                    artifact.id if artifact else None,
                    record.parent_id,
                    record.replaces_id,
                    record.created_at,
                ),
            )
            return record

    def get(self, evidence_id: UUID) -> EvidenceRecord:
        with self.database.connection() as conn:
            return read_evidence(conn, evidence_id)

    def list(self, limit: int = 50, offset: int = 0, search: str = "") -> EvidencePage:
        matches = (
            "FROM evidence_records WHERE (%(search)s = '' OR strpos(lower(concat_ws(' ', "
            "document->>'title', document->>'publisher', document->>'author', "
            "document->>'as_of_date', document->>'published_date')), lower(%(search)s)) > 0)"
        )
        query = search.strip()
        with self.database.connection() as conn:
            rows = conn.execute(
                f"SELECT document {matches} ORDER BY created_at DESC, id DESC "
                "LIMIT %(limit)s OFFSET %(offset)s",
                {"search": query, "limit": limit, "offset": offset},
            ).fetchall()
            total = conn.execute(
                f"SELECT count(*) AS total {matches}", {"search": query}
            ).fetchone()
            assert total is not None
            items = [EvidenceRecord.model_validate(row["document"]) for row in rows]
            return EvidencePage(
                items=items,
                total=total["total"],
                next_offset=offset + len(items) if offset + len(items) < total["total"] else None,
            )


class ClaimStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    def create(self, request: ClaimCreate) -> ClaimRecord:
        digest = request_hash(request)
        with self.database.connection() as conn, conn.transaction():
            conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"claim:{request.id}",)
            )
            existing = conn.execute(
                "SELECT request_hash, document FROM claims WHERE id = %s", (request.id,)
            ).fetchone()
            if existing:
                if existing["request_hash"] != digest:
                    raise ConflictError("This claim ID already belongs to different inputs.")
                return ClaimRecord.model_validate(existing["document"])
            if request.replaces_id:
                read_claim(conn, request.replaces_id)
            for link in request.links:
                read_evidence(conn, link.evidence_id)
            record = ClaimRecord(**request.model_dump(), created_at=datetime.now(UTC))
            conn.execute(
                "INSERT INTO claims (id, request_hash, document, replaces_id, created_at)"
                " VALUES (%s, %s, %s, %s, %s)",
                (
                    record.id,
                    digest,
                    Jsonb(record.model_dump(mode="json")),
                    record.replaces_id,
                    record.created_at,
                ),
            )
            for link in record.links:
                conn.execute(
                    "INSERT INTO claim_evidence (claim_id, evidence_id, relation) "
                    "VALUES (%s, %s, %s)",
                    (record.id, link.evidence_id, link.relation),
                )
            return record

    def get(self, claim_id: UUID) -> ClaimRecord:
        with self.database.connection() as conn:
            return read_claim(conn, claim_id)

    def list(self, limit: int = 50, offset: int = 0) -> ClaimPage:
        with self.database.connection() as conn:
            rows = conn.execute(
                "SELECT document FROM claims ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s",
                (limit, offset),
            ).fetchall()
            total = conn.execute("SELECT count(*) AS total FROM claims").fetchone()
            assert total is not None
            items = [ClaimRecord.model_validate(row["document"]) for row in rows]
            return ClaimPage(
                items=items,
                total=total["total"],
                next_offset=offset + len(items) if offset + len(items) < total["total"] else None,
            )
