"""Append-only, content-deduplicated workflow revisions for the local workspace."""

import hashlib
import json
from uuid import UUID, uuid4

from psycopg import Connection
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

from researchchain.database import Database
from researchchain.models import RevisionSummary, Workflow, WorkflowRevision


class NotFoundError(Exception):
    pass


class ConflictError(Exception):
    pass


def revision_from_row(row: DictRow) -> WorkflowRevision:
    return WorkflowRevision(
        id=row["id"],
        number=row["number"],
        content_hash=row["content_hash"],
        created_at=row["created_at"],
        name=row["workflow"]["name"],
        workflow=row["workflow"],
    )


def read_revision(conn: Connection[DictRow], revision_id: UUID) -> WorkflowRevision:
    row = conn.execute("SELECT * FROM workflow_revisions WHERE id = %s", (revision_id,)).fetchone()
    if row is None:
        raise NotFoundError("Workflow revision not found.")
    return revision_from_row(row)


class RevisionStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    def save(self, workflow: Workflow) -> WorkflowRevision:
        document = workflow.model_dump(mode="json")
        canonical = json.dumps(document, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        content_hash = hashlib.sha256(canonical.encode()).hexdigest()
        with self.database.connection() as conn:
            existing = conn.execute(
                "SELECT * FROM workflow_revisions WHERE content_hash = %s", (content_hash,)
            ).fetchone()
            if existing is not None:
                return revision_from_row(existing)
            conn.execute(
                "INSERT INTO workflow_revisions (id, content_hash, workflow) VALUES (%s, %s, %s) "
                "ON CONFLICT (content_hash) DO NOTHING",
                (uuid4(), content_hash, Jsonb(document)),
            )
            row = conn.execute(
                "SELECT * FROM workflow_revisions WHERE content_hash = %s", (content_hash,)
            ).fetchone()
            assert row is not None
            return revision_from_row(row)

    def get(self, revision_id: UUID) -> WorkflowRevision:
        with self.database.connection() as conn:
            return read_revision(conn, revision_id)

    def list(self, limit: int = 50) -> list[RevisionSummary]:
        with self.database.connection() as conn:
            rows = conn.execute(
                "SELECT id, number, content_hash, created_at, workflow->>'name' AS name "
                "FROM workflow_revisions ORDER BY number DESC LIMIT %s",
                (limit,),
            )
            return [RevisionSummary.model_validate(row) for row in rows]
