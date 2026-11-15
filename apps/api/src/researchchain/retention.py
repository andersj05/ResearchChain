"""Transactional run cleanup with immutable previews, rechecks and retry receipts."""

import hashlib
import json
from collections import Counter
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import datetime, timedelta
from uuid import UUID

from psycopg import Connection, sql
from psycopg.errors import LockNotAvailable
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

from researchchain.database import Database
from researchchain.retention_models import (
    RetentionConfirm,
    RetentionError,
    RetentionOriginal,
    RetentionPreview,
    RetentionReceipt,
    RetentionRequest,
    RetentionRun,
    RetentionView,
)
from researchchain.revisions import NotFoundError

# Delete children first. Checkpoints are upstream tables without foreign keys.
RUN_TABLES = (
    "run_jobs",
    "run_commands",
    "run_node_executions",
    "run_controls",
    "research_attempts",
    "run_research_manifests",
    "run_evidence",
    "checkpoint_writes",
    "checkpoint_blobs",
    "checkpoints",
    "runs",
)
RETAINED_TABLES = (
    "workflow_revisions",
    "evidence_records",
    "claims",
    "claim_evidence",
    "evaluation_references",
    "evaluation_datasets",
    "evaluation_candidates",
    "evaluation_comparisons",
    "evaluation_feedback",
    "evaluation_judges",
    "evaluation_archives",
    "style_guides",
    "report_revisions",
    "report_feedback",
)
TERMINAL = {"completed", "rejected", "cancelled", "limited", "failed"}


def digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


def owner_column(table: str) -> sql.Composable:
    if table == "run_jobs":
        return sql.SQL("(SELECT c.run_id FROM run_commands c WHERE c.id = t.command_id)")
    return sql.Identifier(
        "t",
        "id" if table == "runs" else ("thread_id" if table.startswith("checkpoint") else "run_id"),
    )


def selected_where(
    table: str, ids: Sequence[UUID], *, inverse: bool = False
) -> tuple[sql.Composable, tuple[list[str], ...]]:
    expression = sql.SQL("{}::text = ANY(%s)").format(owner_column(table))
    if inverse:
        expression = sql.SQL("NOT ({})").format(expression)
    return expression, ([str(key) for key in ids],)


def reference_text(table: str) -> sql.Composable:
    # Upstream serializers put addresses in binary msgpack. Escape encoding retains
    # their ASCII bytes even when the surrounding payload is not valid UTF-8.
    if table in ("checkpoint_blobs", "checkpoint_writes"):
        return sql.SQL("(to_jsonb(t) - 'blob')::text || coalesce(encode(t.blob, 'escape'), '')")
    return sql.SQL("to_jsonb(t)::text")


def referenced_originals(
    conn: Connection[DictRow], tables: Sequence[str], ids: Sequence[UUID], *, inverse: bool
) -> set[str]:
    found: set[str] = set()
    for table in tables:
        where, params = (
            selected_where(table, ids, inverse=inverse)
            if table in RUN_TABLES
            else (sql.SQL("true"), ())
        )
        query = sql.SQL(
            "SELECT DISTINCT r AS id FROM {} t CROSS JOIN LATERAL "
            "retention_artifact_refs({}) r WHERE {}"
        ).format(sql.Identifier(table), reference_text(table), where)
        found.update(row["id"] for row in conn.execute(query, params))
    return found


def pinned_runs(conn: Connection[DictRow]) -> set[UUID]:
    found: set[UUID] = set()
    for table in (*RETAINED_TABLES, *RUN_TABLES):
        # Own-run fields are not external references. Cross-run JSON pointers are.
        where = (
            sql.SQL("r::text <> {}::text").format(owner_column(table))
            if (table in RUN_TABLES)
            else sql.SQL("true")
        )
        query = sql.SQL(
            "SELECT DISTINCT r AS id FROM {} t "
            "CROSS JOIN LATERAL retention_run_refs(to_jsonb(t)) r WHERE {}"
        ).format(sql.Identifier(table), where)
        found.update(row["id"] for row in conn.execute(query))
    return found


def run_fingerprint(conn: Connection[DictRow], run_id: UUID) -> str:
    result = hashlib.sha256()
    for table in RUN_TABLES:
        where, params = selected_where(table, [run_id])
        rows = conn.execute(
            sql.SQL(
                "SELECT encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex') AS h "
                "FROM {} t WHERE {} ORDER BY h"
            ).format(sql.Identifier(table), where),
            params,
        )
        result.update(table.encode())
        for row in rows:
            result.update(row["h"].encode())
    return result.hexdigest()


def original_selection(
    conn: Connection[DictRow], ids: Sequence[UUID]
) -> tuple[list[RetentionOriginal], int]:
    candidates = referenced_originals(conn, RUN_TABLES, ids, inverse=False)
    if not candidates:
        return [], 0
    originals = conn.execute(
        "SELECT id, byte_size, encode(sha256(convert_to("
        "jsonb_build_array(id, name, media_type, byte_size, created_at)::text, 'UTF8')), 'hex') "
        "AS fingerprint FROM artifact_blobs WHERE id = ANY(%s) ORDER BY id",
        (sorted(candidates),),
    ).fetchall()
    candidates = {row["id"] for row in originals}
    retained = (
        referenced_originals(conn, (*RETAINED_TABLES, *RUN_TABLES), ids, inverse=True) & candidates
    )
    edges: dict[str, set[str]] = {}
    # Scan each original once, including non-candidate originals. Follow references
    # from retained originals to candidates until no more candidates become pinned.
    for row in conn.execute(
        "SELECT t.id, array(SELECT r FROM retention_artifact_refs(encode(t.content, 'escape')) r "
        "WHERE r = ANY(%s)) AS refs FROM artifact_blobs t",
        (sorted(candidates),),
    ):
        refs = set(row["refs"])
        if row["id"] in candidates:
            edges[row["id"]] = refs
        else:
            retained.update(refs)
    frontier = list(retained)
    while frontier:
        for target in edges.get(frontier.pop(), set()) - retained:
            retained.add(target)
            frontier.append(target)
    selected = [
        RetentionOriginal(
            artifact_id=row["id"], byte_size=row["byte_size"], fingerprint=row["fingerprint"]
        )
        for row in originals
        if row["id"] not in retained
    ]
    return selected, len(retained)


def run_rows(conn: Connection[DictRow], cutoff: datetime) -> list[DictRow]:
    return conn.execute(
        "SELECT r.id, r.created_at, coalesce(ctrl.terminal_status, latest.response->>'status') "
        "AS status, ctrl.active_started_at, "
        "EXISTS (SELECT 1 FROM run_commands c WHERE c.run_id = r.id AND c.response IS NULL) "
        "OR EXISTS (SELECT 1 FROM run_jobs j JOIN run_commands c ON c.id = j.command_id "
        "WHERE c.run_id = r.id AND j.state <> 'finished') AS pending, "
        "EXISTS (SELECT 1 FROM research_attempts a WHERE a.run_id = r.id "
        "AND a.status IN ('preparing', 'requesting', 'unknown')) AS uncertain "
        "FROM runs r LEFT JOIN run_controls ctrl ON ctrl.run_id = r.id "
        "LEFT JOIN LATERAL (SELECT c.response FROM run_commands c WHERE c.run_id = r.id "
        "ORDER BY c.created_at DESC, c.id DESC LIMIT 1) latest ON true "
        "WHERE r.created_at < %s ORDER BY r.created_at, r.id",
        (cutoff,),
    ).fetchall()


def protection(row: DictRow, pinned: set[UUID]) -> str | None:
    if row["id"] in pinned:
        return "Referenced by retained research"
    if row["pending"] or row["active_started_at"] is not None:
        return "Pending or active work"
    if row["uncertain"]:
        return "Uncertain model outcome"
    if row["status"] not in TERMINAL:
        return "Human review or unfinished run"
    return None


def lock_run(conn: Connection[DictRow], run_id: UUID) -> bool:
    row = conn.execute(
        "SELECT pg_try_advisory_xact_lock(hashtextextended(%s, 0)) AS acquired",
        (f"run:{run_id}",),
    ).fetchone()
    assert row
    return bool(row["acquired"])


class RetentionStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    @contextmanager
    def _locked(self) -> Iterator[Connection[DictRow]]:
        try:
            with self.database.connection() as conn, conn.transaction():
                conn.execute("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
                conn.execute("SET LOCAL lock_timeout = '1000ms'")
                conn.execute("SET LOCAL transaction_timeout = '30000ms'")
                # Admission precedes retention. Run locks below never wait; a worker
                # may own one while waiting to make a shared-retention write.
                for key in (
                    f"admission:{self.database.schema}",
                    f"retention:{self.database.schema}",
                ):
                    conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (key,))
                yield conn
        except LockNotAvailable:
            raise RetentionError(
                "Workspace is busy. Retry the same cleanup request.", 429
            ) from None

    @staticmethod
    def _preview(conn: Connection[DictRow], key: UUID) -> RetentionPreview:
        row = conn.execute(
            "SELECT document FROM retention_previews WHERE id = %s", (key,)
        ).fetchone()
        if row is None:
            raise NotFoundError("Cleanup preview not found.")
        return RetentionPreview.model_validate(row["document"])

    def get(self, key: UUID) -> RetentionView:
        with self.database.connection() as conn:
            preview = self._preview(conn, key)
            row = conn.execute(
                "SELECT document FROM retention_receipts WHERE preview_id = %s", (key,)
            ).fetchone()
            return RetentionView(
                preview=preview,
                receipt=RetentionReceipt.model_validate(row["document"]) if row else None,
            )

    def history(self) -> list[RetentionReceipt]:
        with self.database.connection() as conn:
            return [
                RetentionReceipt.model_validate(row["document"])
                for row in conn.execute(
                    "SELECT document FROM retention_receipts ORDER BY applied_at DESC LIMIT 20"
                )
            ]

    def preview(self, request: RetentionRequest) -> RetentionPreview:
        request_hash = digest(request.model_dump(mode="json"))
        with self._locked() as conn:
            existing = conn.execute(
                "SELECT request_hash, document FROM retention_previews WHERE id = %s", (request.id,)
            ).fetchone()
            if existing:
                if existing["request_hash"] != request_hash:
                    raise RetentionError("This preview ID belongs to different cleanup settings.")
                return RetentionPreview.model_validate(existing["document"])
            clock = conn.execute("SELECT clock_timestamp() AS now").fetchone()
            assert clock
            now = clock["now"]
            cutoff = now - timedelta(days=request.older_than_days)
            pins = pinned_runs(conn)
            selected: list[RetentionRun] = []
            protected: Counter[str] = Counter()
            more = 0
            for row in run_rows(conn, cutoff):
                reason = protection(row, pins)
                if reason:
                    protected[reason] += 1
                elif len(selected) >= request.max_runs:
                    more += 1
                elif not lock_run(conn, row["id"]):
                    protected["Run is busy"] += 1
                else:
                    selected.append(
                        RetentionRun(
                            run_id=row["id"],
                            created_at=row["created_at"],
                            status=row["status"],
                            fingerprint=run_fingerprint(conn, row["id"]),
                        )
                    )
            originals, retained = original_selection(conn, [item.run_id for item in selected])
            preview = RetentionPreview(
                id=request.id,
                created_at=now,
                expires_at=now + timedelta(minutes=15),
                cutoff=cutoff,
                request=request,
                runs=selected,
                originals=originals,
                retained_originals=retained,
                original_bytes=sum(item.byte_size for item in originals),
                protected_runs=dict(protected),
                more_eligible=more,
                digest="",
            )
            preview.digest = digest(preview.model_dump(mode="json", exclude={"digest"}))
            conn.execute(
                "INSERT INTO retention_previews "
                "(id, request_hash, document, created_at, expires_at) "
                "VALUES (%s, %s, %s, %s, %s)",
                (
                    request.id,
                    request_hash,
                    Jsonb(preview.model_dump(mode="json")),
                    preview.created_at,
                    preview.expires_at,
                ),
            )
            return preview

    def apply(self, key: UUID, request: RetentionConfirm) -> RetentionReceipt:
        with self._locked() as conn:
            preview = self._preview(conn, key)
            if preview.digest != request.digest:
                raise RetentionError("This confirmation does not match the reviewed preview.")
            previous = conn.execute(
                "SELECT document FROM retention_receipts WHERE preview_id = %s", (key,)
            ).fetchone()
            if previous:
                return RetentionReceipt.model_validate(previous["document"])
            clock = conn.execute("SELECT clock_timestamp() AS now").fetchone()
            assert clock
            now = clock["now"]
            if now >= preview.expires_at:
                raise RetentionError("This cleanup preview expired. Create a new preview.")
            if not preview.runs:
                raise RetentionError("This preview contains no eligible runs.")
            pins = pinned_runs(conn)
            rows = {row["id"]: row for row in run_rows(conn, preview.cutoff)}
            for item in preview.runs:
                row = rows.get(item.run_id)
                if (
                    row is None
                    or protection(row, pins)
                    or not lock_run(conn, item.run_id)
                    or run_fingerprint(conn, item.run_id) != item.fingerprint
                ):
                    raise RetentionError(
                        "A selected run changed or is protected. Create a new preview."
                    )
            ids = [item.run_id for item in preview.runs]
            originals, retained = original_selection(conn, ids)
            if originals != preview.originals or retained != preview.retained_originals:
                raise RetentionError("Original references changed. Create a new preview.")
            original_ids = [item.artifact_id for item in originals]
            for run_id in ids:
                conn.execute(
                    "INSERT INTO retention_run_tombstones (run_id, preview_id, deleted_at) "
                    "VALUES (%s, %s, %s)",
                    (run_id, key, now),
                )
            for artifact_id in original_ids:
                conn.execute(
                    "INSERT INTO retention_artifact_tombstones "
                    "(artifact_id, preview_id, deleted_at) "
                    "VALUES (%s, %s, %s)",
                    (artifact_id, key, now),
                )
            conn.execute(
                "SELECT set_config('researchchain.retention_deletions', %s, true)",
                (
                    json.dumps(
                        {
                            "schema": self.database.schema,
                            "run_ids": [str(x) for x in ids],
                            "artifact_ids": original_ids,
                        }
                    ),
                ),
            )
            deleted: dict[str, int] = {}
            # Jobs must be deleted before their parent commands.
            for table in RUN_TABLES:
                where, params = selected_where(table, ids)
                deleted[table] = conn.execute(
                    sql.SQL("DELETE FROM {} t WHERE {}").format(sql.Identifier(table), where),
                    params,
                ).rowcount
            deleted["artifact_blobs"] = conn.execute(
                "DELETE FROM artifact_blobs WHERE id = ANY(%s)", (original_ids,)
            ).rowcount
            receipt = RetentionReceipt(
                preview_id=key,
                applied_at=now,
                run_ids=ids,
                original_ids=original_ids,
                deleted_rows=deleted,
                original_bytes=preview.original_bytes,
            )
            conn.execute(
                "INSERT INTO retention_receipts (preview_id, document, applied_at) "
                "VALUES (%s, %s, %s)",
                (key, Jsonb(receipt.model_dump(mode="json")), now),
            )
            return receipt
