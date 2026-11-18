"""Resolve Python inputs from pinned evidence and this run's confirmed research receipts."""

from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

from researchchain.analyst_workspace import MAX_FILES, MAX_INPUT_BYTES, MAX_INPUT_FILE_BYTES
from researchchain.artifacts import put_artifact, read_content
from researchchain.research_models import StoredResearchResult, WorkspaceFile
from researchchain.research_prompt import PreparedResearch


def generated_files(
    conn: Connection[DictRow],
    run_id: UUID,
    prepared: PreparedResearch,
    history: list[StoredResearchResult],
) -> dict[str, WorkspaceFile]:
    files: dict[str, WorkspaceFile] = {}
    prior = prepared.previous
    # The text input can also come from the brief or a note. Never dereference a
    # content hash from model/user text without a matching completed run receipt.
    if isinstance(prior, StoredResearchResult) and prior.workspace_files:
        receipt = conn.execute(
            "SELECT 1 FROM research_attempts WHERE run_id = %s AND status = 'completed' "
            "AND result = %s LIMIT 1",
            (run_id, Jsonb(prior.model_dump(mode="json"))),
        ).fetchone()
        if receipt:
            files.update((file.name, file) for file in prior.workspace_files)
    for result in history:
        if result.workspace_activity:
            files.update((file.name, file) for file in result.workspace_activity.files)
    return files


def staged_files(prepared: PreparedResearch, generated: dict[str, WorkspaceFile]) -> dict[str, str]:
    files = {name: file.artifact_id for name, file in generated.items()}
    for evidence_id, source in prepared.sources.items():
        artifact = source.get("artifact")
        if not artifact or source["availability"] != "available":
            continue
        suffix = {
            "text/plain": "txt",
            "text/csv": "csv",
            "text/tab-separated-values": "tsv",
            "image/png": "png",
            "image/jpeg": "jpg",
            "image/webp": "webp",
            "application/pdf": "pdf",
        }.get(artifact["media_type"])
        if suffix:
            files[f"evidence-{evidence_id}.{suffix}"] = artifact["id"]
    return files


def save_files(conn: Connection[DictRow], files: dict[str, bytes]) -> list[WorkspaceFile]:
    saved = []
    for name, content in files.items():
        artifact = put_artifact(conn, content, name)
        saved.append(
            WorkspaceFile(
                name=name,
                artifact_id=artifact.id,
                media_type=artifact.media_type,
                byte_size=artifact.byte_size,
            )
        )
    return saved


def load_files(conn: Connection[DictRow], inputs: dict[str, str]) -> dict[str, bytes]:
    sizes = conn.execute(
        "SELECT id, byte_size FROM artifact_blobs WHERE id = ANY(%s)", (list(inputs.values()),)
    ).fetchall()
    byte_sizes = {row["id"]: row["byte_size"] for row in sizes}
    if any(key not in byte_sizes for key in inputs.values()):
        raise ValueError("A saved Python workspace input is missing.")
    if (
        len(inputs) > MAX_FILES
        or sum(byte_sizes[key] for key in inputs.values()) > MAX_INPUT_BYTES
        or any(size > MAX_INPUT_FILE_BYTES for size in byte_sizes.values())
    ):
        raise ValueError("Python workspace inputs exceed 64 files, 8 MiB per file or 24 MiB total.")
    return {name: read_content(conn, key) for name, key in inputs.items()}
