"""Real PostgreSQL fingerprints distinguish data, structure and original bytes."""

import hashlib

import psycopg
import pytest

from researchchain.backup_inventory import compare_inventory, inventory
from researchchain.backup_models import BackupError
from researchchain.database import Database, migrations


def test_inventory_verifies_content_and_structure(database: Database) -> None:
    with database.connection() as conn, conn.transaction():
        first = inventory(conn, database.schema)
        assert first.tables["schema_migrations"].rows == len(migrations())
        assert first.artifact_count == 0
        compare_inventory(first, inventory(conn, database.schema))
        conn.execute("CREATE TABLE backup_test_value (id integer)")
        changed = inventory(conn, database.schema)
        with pytest.raises(BackupError, match="table contents"):
            compare_inventory(first, changed)
        conn.execute("ALTER TABLE backup_test_value ADD CHECK (id>0)")
        constrained = inventory(conn, database.schema)
        with pytest.raises(BackupError, match="schema structure"):
            compare_inventory(changed, constrained)
        conn.execute("INSERT INTO backup_test_value VALUES (1),(2)")
        with pytest.raises(BackupError, match="table contents"):
            compare_inventory(constrained, inventory(conn, database.schema))


def test_inventory_checks_original_bytes_and_sequence_floors(database: Database) -> None:
    content = bytes(range(256)) + b"\r\n\x00\xff"
    identifier = "sha256:" + hashlib.sha256(content).hexdigest()
    with database.connection() as conn, conn.transaction():
        conn.execute(
            "INSERT INTO artifact_blobs(id,content,byte_size,media_type,name) "
            "VALUES (%s,%s,%s,%s,%s)",
            (identifier, content, len(content), "application/octet-stream", "synthetic.bin"),
        )
        first = inventory(conn, database.schema)
        assert (first.artifact_count, first.artifact_bytes) == (1, len(content))
        conn.execute("SELECT nextval('workflow_revisions_number_seq')")
        later = inventory(conn, database.schema)
        compare_inventory(first, later)
        with pytest.raises(BackupError, match="sequence"):
            compare_inventory(later, first)
        # Restore must preserve the immutability trigger too.
        with pytest.raises(psycopg.IntegrityError), conn.transaction():
            conn.execute("DELETE FROM artifact_blobs")
        conn.execute(
            "INSERT INTO artifact_blobs(id,content,byte_size,media_type,name) "
            "VALUES (%s,%s,%s,%s,%s)",
            ("sha256:" + "0" * 64, b"wrong", 5, "text/plain", "synthetic.txt"),
        )
        with pytest.raises(BackupError, match="original"):
            inventory(conn, database.schema)
