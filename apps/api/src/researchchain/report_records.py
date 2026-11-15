"""Private helpers for immutable editorial tables."""

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from psycopg import Connection, sql
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

from researchchain.evidence import request_hash
from researchchain.research_models import ResearchModel
from researchchain.revisions import ConflictError, NotFoundError

Table = Literal["style_guides", "report_revisions", "report_feedback"]


def read_record[T: ResearchModel](
    conn: Connection[DictRow], table: Table, key: UUID, model: type[T]
) -> T:
    row = conn.execute(
        sql.SQL("SELECT document FROM {} WHERE id = %s").format(sql.Identifier(table)), (key,)
    ).fetchone()
    if row is None:
        raise NotFoundError("Editorial record not found.")
    return model.model_validate(row["document"])


def retry_record[T: ResearchModel](
    conn: Connection[DictRow], table: Table, key: UUID, request: ResearchModel, model: type[T]
) -> T | None:
    conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"{table}:{key}",))
    row = conn.execute(
        sql.SQL("SELECT request_hash, document FROM {} WHERE id = %s").format(
            sql.Identifier(table)
        ),
        (key,),
    ).fetchone()
    if row:
        if row["request_hash"] != request_hash(request):
            raise ConflictError("This editorial request ID already belongs to different inputs.")
        return model.model_validate(row["document"])
    return None


def require_head(conn: Connection[DictRow], table: Table, previous: UUID) -> None:
    conn.execute(
        "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"{table}:head:{previous}",)
    )
    if conn.execute(
        sql.SQL("SELECT 1 FROM {} WHERE replaces_id = %s").format(sql.Identifier(table)),
        (previous,),
    ).fetchone():
        raise ConflictError(
            "A newer revision exists. Keep your draft and open the latest revision before saving."
        )


def insert_version(
    conn: Connection[DictRow], table: Table, record: ResearchModel, request: ResearchModel
) -> None:
    document = record.model_dump(mode="json")
    conn.execute(
        sql.SQL(
            "INSERT INTO {} (id,series_id,version,replaces_id,request_hash,document) "
            "VALUES (%s,%s,%s,%s,%s,%s)"
        ).format(sql.Identifier(table)),
        (
            document["id"],
            document["series_id"],
            document["version"],
            document["replaces_id"],
            request_hash(request),
            Jsonb(document),
        ),
    )


def now() -> datetime:
    return datetime.now(UTC)
