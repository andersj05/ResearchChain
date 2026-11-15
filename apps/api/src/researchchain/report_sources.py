"""Source classification and quote checks for human-edited reports."""

from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from researchchain.artifacts import EvidenceError, read_content
from researchchain.evidence_models import EvidenceRecord
from researchchain.report_models import ReportSection

IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}


def source_basis(conn: Connection[DictRow], record: EvidenceRecord) -> str:
    if not record.artifact or record.availability != "available":
        return "metadata_only"
    media = record.artifact.media_type
    if media in IMAGE_TYPES:
        return "image_interpretation"
    if media == "application/pdf":
        return "document_interpretation"
    if not media.startswith("text/"):
        return "metadata_only"
    basis = {
        "numeric_data": "numeric_source",
        "digitized_estimate": "estimate",
        "ocr_interpretation": "ocr_interpretation",
    }.get(record.representation, "source_text")
    if basis == "source_text":
        inherited = conn.execute(
            "WITH RECURSIVE lineage AS (SELECT id, parent_id, replaces_id, "
            "document->>'representation' AS representation FROM evidence_records WHERE id = %s "
            "UNION SELECT e.id,e.parent_id,e.replaces_id,e.document->>'representation' "
            "FROM evidence_records e JOIN lineage l ON e.id = l.parent_id OR e.id = l.replaces_id) "
            "SELECT 1 FROM lineage WHERE representation IN "
            "('chart_screenshot','ocr_interpretation','digitized_estimate') LIMIT 1",
            (record.id,),
        ).fetchone()
        if inherited:
            return "estimate"
    return basis


def validate_sources(
    conn: Connection[DictRow], sections: list[ReportSection], sources: list[EvidenceRecord]
) -> None:
    if sum(s.artifact.byte_size for s in sources if s.artifact) > 64 * 1024 * 1024:
        raise EvidenceError("Report source originals must total at most 64 MB.")
    records = {item.id: item for item in sources}
    bases = {item.id: source_basis(conn, item) for item in sources}
    texts: dict[UUID, str] = {}
    for section in sections:
        for key in section.chart_ids:
            source = records.get(key)
            if not source or not source.artifact or source.artifact.media_type not in IMAGE_TYPES:
                raise EvidenceError(
                    "Charts must reference captured PNG, JPEG or WebP sources in this report."
                )
        for citation in section.citations:
            source = records.get(citation.evidence_id)
            if not source or citation.basis != bases[source.id]:
                raise EvidenceError(
                    "A citation must refer to a report source with its actual representation."
                )
            if citation.basis == "metadata_only" and (
                citation.relation != "context" or citation.quote
            ):
                raise EvidenceError(
                    "Uncaptured or unsupported sources provide context only, without quotations."
                )
            if citation.quote:
                if not source.artifact or not source.artifact.media_type.startswith("text/"):
                    raise EvidenceError(
                        "Visual or document interpretations cannot contain verified quotations."
                    )
                if source.id not in texts:
                    texts[source.id] = read_content(conn, source.artifact.id).decode("utf-8-sig")
                if citation.quote not in texts[source.id]:
                    raise EvidenceError(
                        "A quotation must occur exactly in the captured source text."
                    )
