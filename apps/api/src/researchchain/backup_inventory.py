"""Snapshot fingerprints and schema checks for a verified logical restore."""

import hashlib
import json

from psycopg import Connection, sql
from psycopg.rows import DictRow

from researchchain.backup_models import (
    BackupError,
    BackupInventory,
    SequenceFloor,
    TableFingerprint,
)

# Ownership/ACLs intentionally change on restore. Everything below describes
# application structure; each source/target connection uses the same search_path.
STRUCTURE_QUERIES = (
    """
    SELECT c.relname AS name, c.relkind AS kind, a.attnum AS ordinal, a.attname AS column,
           format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS required,
           a.attidentity AS identity, a.attgenerated AS generated,
           pg_get_expr(d.adbin,d.adrelid) AS default_expression
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname=%s AND c.relkind IN ('r','p','v','m')
    ORDER BY c.relname,a.attnum
    """,
    """
    SELECT c.relname AS name, k.conname, pg_get_constraintdef(k.oid,false) AS definition
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=%s ORDER BY c.relname,k.conname
    """,
    """
    SELECT c.relname AS name, pg_get_indexdef(c.oid) AS definition
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=%s AND c.relkind IN ('i','I') ORDER BY c.relname
    """,
    """
    SELECT c.relname AS name, t.tgname, pg_get_triggerdef(t.oid,false) AS definition,
           t.tgenabled AS enabled
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=%s AND NOT t.tgisinternal ORDER BY c.relname,t.tgname
    """,
    """
    SELECT pg_get_functiondef(p.oid) AS definition FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=%s AND p.prokind IN ('f','p') ORDER BY definition
    """,
    """
    SELECT c.relname AS name, pg_get_viewdef(c.oid,false) AS definition
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=%s AND c.relkind IN ('v','m') ORDER BY c.relname
    """,
    """
    SELECT c.relname AS name,s.seqstart,s.seqincrement,s.seqmax,s.seqmin,s.seqcache,s.seqcycle
    FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=%s ORDER BY c.relname
    """,
)


def inventory(conn: Connection[DictRow], schema: str) -> BackupInventory:
    conn.execute("SELECT set_config('TimeZone','UTC',true)")
    conn.execute("SELECT set_config('DateStyle','ISO, YMD',true)")
    conn.execute("SELECT set_config('bytea_output','hex',true)")
    tables = conn.execute(
        "SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE n.nspname=%s AND c.relkind IN ('r','p','m','f') ORDER BY c.relname",
        (schema,),
    ).fetchall()
    if not tables or len(tables) > 256 or any(t["relkind"] == "f" for t in tables):
        raise BackupError("Backups require 1–256 local tables; foreign-table data is unsupported.")
    fingerprints: dict[str, TableFingerprint] = {}
    for table in tables:
        # ONLY avoids counting partition/inheritance children twice. pg_dump
        # contains every table; each is independently fingerprinted.
        statement = sql.SQL(
            "SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS hash "
            "FROM ONLY {} AS t ORDER BY hash"
        ).format(sql.Identifier(schema, table["relname"]))
        fingerprint = hashlib.sha256()
        count = 0
        with conn.cursor(name="backup_fingerprint") as cursor:
            cursor.execute(statement)
            for row in cursor:
                fingerprint.update(row["hash"].encode("ascii") + b"\n")
                count += 1
        fingerprints[table["relname"]] = TableFingerprint(
            rows=count, sha256=fingerprint.hexdigest()
        )
    sequences: dict[str, SequenceFloor] = {}
    for row in conn.execute(STRUCTURE_QUERIES[-1], (schema,)):
        if row["seqincrement"] != 1 or row["seqcycle"] or row["seqmin"] != 1:
            raise BackupError("Backups support positive, non-cycling application sequences.")
        value = conn.execute(
            sql.SQL("SELECT last_value,is_called FROM {}").format(
                sql.Identifier(schema, row["name"])
            )
        ).fetchone()
        assert value
        sequences[row["name"]] = SequenceFloor(**value)
    structure = [conn.execute(query, (schema,)).fetchall() for query in STRUCTURE_QUERIES]
    structure_hash = hashlib.sha256(
        json.dumps(structure, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    artifacts = conn.execute(
        "SELECT count(*) AS count,coalesce(sum(byte_size),0)::bigint AS bytes,"
        "count(*) FILTER (WHERE id <> 'sha256:' || encode(sha256(content),'hex') "
        "OR octet_length(content) <> byte_size) AS invalid FROM artifact_blobs"
    ).fetchone()
    if not artifacts or artifacts["invalid"]:
        raise BackupError(
            "An original's content hash or byte size does not match; backup verification failed."
        )
    return BackupInventory(
        tables=fingerprints,
        sequences=sequences,
        structure_hash=structure_hash,
        artifact_count=artifacts["count"],
        artifact_bytes=artifacts["bytes"],
    )


def compare_inventory(expected: BackupInventory, actual: BackupInventory) -> None:
    if expected.tables != actual.tables:
        raise BackupError("Restored table contents do not match the backup snapshot.")
    if expected.structure_hash != actual.structure_hash:
        raise BackupError("Restored schema structure does not match the backup snapshot.")
    if (expected.artifact_count, expected.artifact_bytes) != (
        actual.artifact_count,
        actual.artifact_bytes,
    ):
        raise BackupError("Restored originals do not match the backup snapshot.")
    if expected.sequences.keys() != actual.sequences.keys():
        raise BackupError("Restored sequences do not match the backup snapshot.")
    for name, floor in expected.sequences.items():
        restored = actual.sequences[name]
        # Sequences are not MVCC data and can advance during a live dump.
        # The archived value must never move behind the pre-dump floor.
        if restored.last_value < floor.last_value or (
            restored.last_value == floor.last_value and floor.is_called and not restored.is_called
        ):
            raise BackupError("A restored sequence is behind its backup floor.")
