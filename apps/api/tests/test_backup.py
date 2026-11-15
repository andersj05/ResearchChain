"""Backups use real PostgreSQL archives and fresh disposable restore databases."""

import json
from pathlib import Path
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from psycopg.conninfo import make_conninfo
from test_evaluation_datasets import case_for, dataset, reference
from test_reports import feedback, seeded

from researchchain.artifacts import put_artifact, read_content
from researchchain.backup import create_backup
from researchchain.backup_files import ARCHIVE, MANIFEST
from researchchain.backup_models import BackupError
from researchchain.backup_restore import restore_backup
from researchchain.backup_tools import PostgreSQLTools
from researchchain.database import Database
from researchchain.evaluation_datasets import EvaluationDatasets
from researchchain.graph import Workflow
from researchchain.models import ResumeRequest, RunRequest
from researchchain.reports import Reports, StyleGuides
from researchchain.revisions import RevisionStore
from researchchain.runtime import RunStore


def test_round_trip_preserves_originals_reviews_and_paused_run(
    database: Database,
    tmp_path: Path,
    restore_target: str,
    workflow: dict,
) -> None:
    record, guide, evidence, _ = seeded(database)
    Reports(database).feedback(record.id, feedback(record))
    baseline = reference(database)
    evaluation = dataset(database, case_for(evidence, reference_ids=[baseline.id]))
    revision = RevisionStore(database).save(Workflow.model_validate(workflow))
    paused = RunStore(database).start(
        RunRequest(id=uuid4(), revision_id=revision.id, brief="Synthetic restore rehearsal")
    )
    content = bytes(range(256)) * 1024 + b"\r\n\x00\xff"
    with database.connection() as conn:
        original = put_artifact(conn, content, "binary-original.bin")
    directory = tmp_path / "backup"
    manifest = create_backup(database, directory)
    assert manifest.inventory.artifact_count >= 3
    assert manifest.inventory.tables["checkpoints"].rows > 0
    assert manifest.code_revision and not manifest.includes_provider_credentials
    receipt = restore_backup(database, directory, restore_target, trusted=True)
    restored = Database(make_conninfo(database.url, dbname=restore_target), database.schema)
    assert receipt.provider_calls == 0
    assert receipt.original_count == manifest.inventory.artifact_count
    assert Reports(restored).get(record.id) == Reports(database).get(record.id)
    assert StyleGuides(restored).get(guide.id) == guide
    assert EvaluationDatasets(restored).get(evaluation.id) == evaluation
    assert baseline in EvaluationDatasets(restored).references()
    with restored.connection() as conn:
        assert read_content(conn, original.id) == content
        with pytest.raises(psycopg.IntegrityError, match="immutable"), conn.transaction():
            conn.execute("DELETE FROM report_revisions")
        assert (
            conn.execute("SELECT nextval('workflow_revisions_number_seq') AS n").fetchone()["n"]
            > revision.number
        )
    store = RunStore(restored)
    recovered = store.get(paused.id)
    assert recovered == paused
    assert recovered.review and recovered.checkpoint_id
    completed = store.resume(
        paused.id,
        ResumeRequest(
            checkpoint_id=recovered.checkpoint_id,
            interrupt_id=recovered.review.interrupt_id,
            decision="approve",
        ),
    )
    assert completed.status == "completed"
    assert RunStore(database).get(paused.id) == paused


def test_dump_shares_snapshot_with_manifest(
    database: Database,
    tmp_path: Path,
    restore_target: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with database.connection() as conn:
        original = put_artifact(conn, b"before snapshot", "before.txt")
    run = PostgreSQLTools.run

    def after_snapshot(self: PostgreSQLTools, tool: str, *args: Any, **kwargs: Any) -> bytes:
        if tool == "pg_dump" and "--version" not in args[1]:
            with database.connection() as conn:
                put_artifact(conn, b"committed after exported snapshot", "later.txt")
        return run(self, tool, *args, **kwargs)

    monkeypatch.setattr(PostgreSQLTools, "run", after_snapshot)
    directory = tmp_path / "backup"
    manifest = create_backup(database, directory)
    assert manifest.inventory.artifact_count == 1
    restore_backup(database, directory, restore_target, trusted=True)
    restored = Database(make_conninfo(database.url, dbname=restore_target), database.schema)
    with restored.connection() as conn:
        assert read_content(conn, original.id) == b"before snapshot"
        assert conn.execute("SELECT count(*) AS n FROM artifact_blobs").fetchone()["n"] == 1
    with database.connection() as conn:
        assert conn.execute("SELECT count(*) AS n FROM artifact_blobs").fetchone()["n"] == 2


@pytest.mark.parametrize("damage", ["checksum", "manifest", "migrations", "checkpoint", "version"])
def test_invalid_archive_refused_before_creating_target(
    database: Database,
    tmp_path: Path,
    restore_target: str,
    damage: str,
) -> None:
    directory = tmp_path / "backup"
    manifest = create_backup(database, directory)
    if damage == "checksum":
        with (directory / ARCHIVE).open("ab") as output:
            output.write(b"corrupt")
    else:
        data = manifest.model_dump(mode="json")
        if damage == "manifest":
            data["unexpected_password"] = "never show validation input"
        elif damage == "migrations":
            data["migrations"][next(iter(data["migrations"]))] = "0" * 64
        elif damage == "checkpoint":
            data["checkpoint_migrations"] = []
        else:
            data["client_major"] = 17
        (directory / MANIFEST).write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(BackupError) as error:
        restore_backup(database, directory, restore_target, trusted=True)
    assert "never show validation input" not in str(error.value)
    with database.connection() as conn:
        assert not conn.execute(
            "SELECT 1 FROM pg_database WHERE datname=%s", (restore_target,)
        ).fetchone()


def test_target_and_trust_guards(database: Database, tmp_path: Path, restore_target: str) -> None:
    directory = tmp_path / "backup"
    create_backup(database, directory)
    with pytest.raises(BackupError, match="already exists"):
        create_backup(database, directory)
    with pytest.raises(BackupError, match="trusted"):
        restore_backup(database, directory, restore_target)
    with pytest.raises(BackupError, match="lowercase"):
        restore_backup(database, directory, "bad; DROP DATABASE researchchain", trusted=True)
    with database.connection() as conn:
        current = conn.info.dbname
    with pytest.raises(BackupError, match="connected database"):
        restore_backup(database, directory, current, trusted=True)
    restore_backup(database, directory, restore_target, trusted=True)
    with pytest.raises(BackupError, match="already exists"):
        restore_backup(database, directory, restore_target, trusted=True)
