"""Bounded immutable originals. No paths, rendering, fetching, or instructions."""

import csv
import hashlib
import io
from decimal import Decimal, InvalidOperation
from typing import Literal

from psycopg import Connection
from psycopg.rows import DictRow

from researchchain.database import Database
from researchchain.evidence_models import ArtifactInfo, ContentPreview
from researchchain.revisions import NotFoundError

MAX_ARTIFACT_BYTES = 20 * 1024 * 1024


class EvidenceError(ValueError):
    pass


def inspect_type(content: bytes, name: str) -> str:
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    if content.startswith(b"%PDF-"):
        return "application/pdf"
    try:
        content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return "application/octet-stream"
    if b"\x00" in content:
        return "application/octet-stream"
    if name.lower().endswith(".csv"):
        return "text/csv"
    if name.lower().endswith(".tsv"):
        return "text/tab-separated-values"
    return "text/plain"


def read_artifact(conn: Connection[DictRow], content_id: str) -> ArtifactInfo:
    row = conn.execute(
        "SELECT id, name, media_type, byte_size, created_at FROM artifact_blobs WHERE id = %s",
        (content_id,),
    ).fetchone()
    if row is None:
        raise NotFoundError("Original content not found.")
    return ArtifactInfo.model_validate(row)


def read_content(conn: Connection[DictRow], content_id: str) -> bytes:
    row = conn.execute("SELECT content FROM artifact_blobs WHERE id = %s", (content_id,)).fetchone()
    if row is None:
        raise NotFoundError("Original content not found.")
    return bytes(row["content"])


def put_artifact(conn: Connection[DictRow], content: bytes, name: str) -> ArtifactInfo:
    if not 0 < len(content) <= MAX_ARTIFACT_BYTES:
        raise EvidenceError("Originals must contain between 1 byte and 20 MB.")
    if not name.strip() or len(name) > 240 or any(ord(char) < 32 for char in name):
        raise EvidenceError("Choose a filename of 1–240 characters without control characters.")
    content_id = f"sha256:{hashlib.sha256(content).hexdigest()}"
    conn.execute(
        "INSERT INTO artifact_blobs (id, name, media_type, byte_size, content) "
        "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING",
        (content_id, name, inspect_type(content, name), len(content), content),
    )
    return read_artifact(conn, content_id)


def numeric_preview(content: bytes, table_format: Literal["csv", "tsv"]) -> ContentPreview:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise EvidenceError("Numeric records require a UTF-8 CSV or TSV original.") from error
    if "\x00" in text:
        raise EvidenceError("Numeric records cannot contain null bytes.")
    reader = csv.reader(
        io.StringIO(text),
        delimiter="\t" if table_format == "tsv" else ",",
        strict=True,
    )
    try:
        columns = next(reader, [])
        if not columns or len(columns) > 128 or len(set(columns)) != len(columns):
            raise EvidenceError("Data needs 1–128 distinct column names.")
        if any(not column.strip() or len(column) > 240 for column in columns):
            raise EvidenceError("Data column names must contain 1–240 characters.")
        rows: list[list[str]] = []
        numeric = [True] * len(columns)
        present = [False] * len(columns)
        count = 0
        cropped = False
        for row in reader:
            if not row:
                continue
            count += 1
            if count > 100000:
                raise EvidenceError("Data inspection supports at most 100,000 rows per original.")
            if len(row) != len(columns) or any(len(cell) > 10000 for cell in row):
                raise EvidenceError(
                    "Every row must match the header, with cells up to 10,000 characters."
                )
            for index, value in enumerate(row):
                if not value.strip():
                    continue
                present[index] = True
                try:
                    numeric[index] = numeric[index] and Decimal(value).is_finite()
                except InvalidOperation:
                    numeric[index] = False
            if len(rows) < 12:
                cropped = cropped or any(len(cell) > 240 for cell in row)
                rows.append([cell[:240] for cell in row])
        numeric_columns = [
            column for index, column in enumerate(columns) if numeric[index] and present[index]
        ]
        if not count or not numeric_columns:
            raise EvidenceError("Data must include rows and at least one finite numeric column.")
    except csv.Error as error:
        raise EvidenceError("The original is not a well-formed CSV/TSV table.") from error
    return ContentPreview(
        columns=columns,
        rows=rows,
        row_count=count,
        numeric_columns=numeric_columns,
        parser_version="csv-1",
        truncated=cropped or count > len(rows),
    )


def preview_content(content: bytes, media_type: str) -> ContentPreview:
    if media_type.startswith("text/"):
        text = content.decode("utf-8-sig")
        return ContentPreview(text=text[:12000], truncated=len(text) > 12000)
    return ContentPreview()


class ArtifactStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    def put(self, content: bytes, name: str) -> ArtifactInfo:
        with self.database.connection() as conn:
            return put_artifact(conn, content, name)

    def get(self, content_id: str) -> ArtifactInfo:
        with self.database.connection() as conn:
            return read_artifact(conn, content_id)

    def content(self, content_id: str) -> tuple[ArtifactInfo, bytes]:
        with self.database.connection() as conn:
            return read_artifact(conn, content_id), read_content(conn, content_id)
