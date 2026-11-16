"""Named agents, optimistic version saves and exact run ownership."""

from __future__ import annotations

from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from researchchain.agent_models import (
    AgentCreate,
    AgentDetail,
    AgentSave,
    AgentSummary,
    AgentVersion,
)
from researchchain.database import Database
from researchchain.revisions import ConflictError, NotFoundError, read_revision, save_revision

_COLUMNS = "id, name, version, revision_id, created_at, updated_at"


def read_agent(conn: Connection[DictRow], agent_id: UUID, *, lock: bool = False) -> AgentSummary:
    row = conn.execute(
        f"SELECT {_COLUMNS} FROM agents WHERE id = %s" + (" FOR UPDATE" if lock else ""),
        (agent_id,),
    ).fetchone()
    if row is None:
        raise NotFoundError("Agent not found.")
    return AgentSummary.model_validate(row)


def run_agent(conn: Connection[DictRow], run_id: UUID) -> DictRow:
    return conn.execute(
        "SELECT agent_id, agent_name FROM agent_runs WHERE run_id = %s", (run_id,)
    ).fetchone() or {"agent_id": None, "agent_name": None}


def require_agent_revision(
    conn: Connection[DictRow], agent_id: UUID, revision_id: UUID
) -> AgentSummary:
    agent = read_agent(conn, agent_id)
    if not conn.execute(
        "SELECT 1 FROM agent_revisions WHERE agent_id = %s AND revision_id = %s",
        (agent_id, revision_id),
    ).fetchone():
        raise ConflictError("This revision does not belong to the selected agent.")
    return agent


class AgentStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    def create(self, request: AgentCreate) -> AgentDetail:
        with self.database.connection() as conn, conn.transaction():
            conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                (f"agent:{self.database.schema}:{request.id}",),
            )
            revision = save_revision(conn, request.workflow)
            inserted = conn.execute(
                "INSERT INTO agents (id, name, version, revision_id, creation_hash) "
                "VALUES (%s, %s, 1, %s, %s) ON CONFLICT (id) DO NOTHING RETURNING id",
                (request.id, revision.name, revision.id, revision.content_hash),
            ).fetchone()
            agent = read_agent(conn, request.id, lock=True)
            if inserted:
                conn.execute(
                    "INSERT INTO agent_revisions (agent_id, version, revision_id) "
                    "VALUES (%s, 1, %s)",
                    (agent.id, revision.id),
                )
            else:
                prior = conn.execute(
                    "SELECT creation_hash FROM agents WHERE id = %s", (request.id,)
                ).fetchone()
                assert prior
                if prior["creation_hash"] != revision.content_hash:
                    raise ConflictError(
                        "This agent ID was already used for a different creation request."
                    )
            return AgentDetail(agent=agent, revision=read_revision(conn, agent.revision_id))

    def get(self, agent_id: UUID) -> AgentDetail:
        with self.database.connection() as conn:
            agent = read_agent(conn, agent_id)
            return AgentDetail(agent=agent, revision=read_revision(conn, agent.revision_id))

    def save(self, agent_id: UUID, request: AgentSave) -> AgentDetail:
        with self.database.connection() as conn, conn.transaction():
            conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                (f"agent:{self.database.schema}:{agent_id}",),
            )
            agent = read_agent(conn, agent_id, lock=True)
            revision = save_revision(conn, request.workflow)
            if revision.id == agent.revision_id:
                return AgentDetail(agent=agent, revision=revision)
            if request.expected_version != agent.version:
                raise ConflictError(
                    "This agent changed in another tab. Reload its latest version before saving; "
                    "your draft is still available."
                )
            conn.execute(
                "INSERT INTO agent_revisions (agent_id, version, revision_id) VALUES (%s, %s, %s)",
                (agent_id, agent.version + 1, revision.id),
            )
            conn.execute(
                "UPDATE agents SET name = %s, revision_id = %s, version = version + 1, "
                "updated_at = clock_timestamp() WHERE id = %s",
                (revision.name, revision.id, agent_id),
            )
            return AgentDetail(agent=read_agent(conn, agent_id), revision=revision)

    def versions(self, agent_id: UUID, limit: int = 100) -> list[AgentVersion]:
        with self.database.connection() as conn:
            read_agent(conn, agent_id)
            rows = conn.execute(
                "SELECT version, revision_id FROM agent_revisions WHERE agent_id = %s "
                "ORDER BY version DESC LIMIT %s",
                (agent_id, limit),
            )
            return [
                AgentVersion(
                    version=row["version"], revision=read_revision(conn, row["revision_id"])
                )
                for row in rows.fetchall()
            ]

    def list(self, limit: int = 100) -> list[AgentSummary]:
        with self.database.connection() as conn:
            return [
                AgentSummary.model_validate(row)
                for row in conn.execute(
                    f"SELECT {_COLUMNS} FROM agents ORDER BY updated_at DESC, id DESC LIMIT %s",
                    (limit,),
                )
            ]
