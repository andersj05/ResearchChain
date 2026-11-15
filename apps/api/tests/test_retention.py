"""Destructive retention tests use only the fixture's disposable synthetic schemas."""

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event
from uuid import uuid4

import psycopg
import pytest
from access_fixtures import owner_client
from fastapi.testclient import TestClient
from psycopg import sql
from psycopg.types.json import Jsonb
from test_dispatch import setup_queue
from test_research_runtime import setup_run

from researchchain.artifacts import ArtifactStore
from researchchain.database import Database
from researchchain.main import create_app
from researchchain.models import RunRequest, Workflow
from researchchain.retention import RUN_TABLES, RetentionStore, selected_where
from researchchain.retention_models import RetentionConfirm, RetentionError, RetentionRequest
from researchchain.revisions import RevisionStore
from researchchain.runtime import RunStore

CANARY = "synthetic-private-brief-never-stored-in-cleanup-receipts"


def terminal(database, workflow, *, content=b"synthetic unused original"):
    original = ArtifactStore(database).put(content, "synthetic.txt")
    revision = RevisionStore(database).save(Workflow.model_validate(workflow))
    request = RunRequest(
        id=uuid4(),
        revision_id=revision.id,
        brief=CANARY,
        artifacts=[original.model_dump(include={"id", "name", "media_type"})],
    )
    runs = RunStore(database)
    runs.start(request)
    runs.cancel(request.id)
    return runs, request, original


def preview(store, **changes):
    return store.preview(RetentionRequest(id=uuid4(), older_than_days=0, **changes))


def apply(store, record):
    return store.apply(record.id, RetentionConfirm(digest=record.digest, confirmation="DELETE"))


def test_cleanup_deletes_complete_run_history_and_retries_return_one_receipt(database, workflow):
    runs, request, original = terminal(database, workflow)
    store = RetentionStore(database)
    record = preview(store)
    assert [r.run_id for r in record.runs] == [request.id]
    assert [a.artifact_id for a in record.originals] == [original.id]
    assert record.original_bytes == original.byte_size
    assert CANARY not in record.model_dump_json()
    assert "synthetic.txt" not in record.model_dump_json()
    assert store.preview(record.request) == record
    with pytest.raises(RetentionError, match="different cleanup settings"):
        store.preview(record.request.model_copy(update={"max_runs": 1}))
    result = apply(store, record)
    assert result.run_ids == [request.id] and result.original_ids == [original.id]
    assert result.deleted_rows["checkpoints"] > 0
    assert result.deleted_rows["run_node_executions"] > 0
    assert apply(store, record) == result == store.get(record.id).receipt
    assert store.history() == [result]
    assert CANARY not in result.model_dump_json()
    with database.connection() as conn:
        for table in RUN_TABLES:
            where, params = selected_where(table, [request.id])
            assert not conn.execute(
                sql.SQL("SELECT 1 FROM {} t WHERE {}").format(sql.Identifier(table), where), params
            ).fetchone()
        assert not conn.execute(
            "SELECT 1 FROM artifact_blobs WHERE id=%s", (original.id,)
        ).fetchone()
        assert conn.execute("SELECT count(*) AS n FROM workflow_revisions").fetchone()["n"] == 1
    for action in (
        lambda: runs.start(request),
        lambda: runs.get(request.id),
        lambda: runs.recover(request.id),
    ):
        with pytest.raises(RetentionError) as error:
            action()
        assert error.value.status == 410


def test_research_tombstone_precedes_provider_selection_and_removes_attempt_originals(
    database, monkeypatch
):
    runs, request, provider = setup_run(database)
    runs.start(request)
    runs.cancel(request.id)
    record = preview(RetentionStore(database))
    assert len(record.originals) == 2
    apply(RetentionStore(database), record)

    def unexpected(*args):
        raise AssertionError("Deleted work must never select a provider")

    monkeypatch.setattr(provider, "pin_account", unexpected)
    with pytest.raises(RetentionError) as error:
        runs.start(request)
    assert error.value.status == 410
    assert len(provider.calls) == 1


@pytest.mark.parametrize(
    "pin_table",
    [
        "report_revisions",
        "evaluation_candidates",
        "evaluation_archives",
    ],
)
def test_structured_nested_report_and_evaluation_references_protect_run(
    database, workflow, pin_table
):
    _, request, _ = terminal(database, workflow)
    # Typed run references remain protected even inside archived arrays.
    table = pin_table
    document = {"bundle": [{"candidates": [{"provenance": {"run_id": str(request.id)}}]}]}
    with database.connection() as conn:
        if table == "report_revisions":
            conn.execute(
                "INSERT INTO report_revisions (id, series_id, version, request_hash, document) "
                "VALUES (%s,%s,1,'synthetic',%s)",
                (uuid4(), uuid4(), Jsonb(document)),
            )
        elif table == "evaluation_candidates":
            dataset_id = uuid4()
            conn.execute(
                "INSERT INTO evaluation_datasets (id,series_id,version,request_hash,document) "
                "VALUES (%s,%s,1,'synthetic','{}')",
                (dataset_id, uuid4()),
            )
            conn.execute(
                "INSERT INTO evaluation_candidates (id,dataset_id,case_id,request_hash,document) "
                "VALUES (%s,%s,'synthetic','synthetic',%s)",
                (uuid4(), dataset_id, Jsonb(document)),
            )
        else:
            conn.execute(
                "INSERT INTO evaluation_archives (id, content_hash, document) VALUES (%s,%s,%s)",
                (uuid4(), uuid4().hex, Jsonb(document)),
            )
    record = preview(RetentionStore(database))
    assert not record.runs
    assert record.protected_runs["Referenced by retained research"] == 1


def test_pending_review_uncertain_jobs_and_busy_readers_are_protected(database, workflow):
    queue, request = setup_queue(database, workflow)
    queue.start(request)
    store = RetentionStore(database)
    assert preview(store).protected_runs["Pending or active work"] == 1
    runs, pending, provider = setup_run(database)
    snapshot = runs.start(pending)
    assert snapshot.status == "paused"
    record = preview(store)
    assert record.protected_runs["Human review or unfinished run"] == 1
    runs.cancel(pending.id)
    with database.connection() as conn:
        conn.execute("UPDATE research_attempts SET status='unknown' WHERE run_id=%s", (pending.id,))
    assert preview(store).protected_runs["Uncertain model outcome"] == 1
    _, done, _ = terminal(database, workflow)
    with database.connection() as reader:
        reader.execute("SELECT pg_advisory_lock(hashtextextended(%s,0))", (f"run:{done.id}",))
        record = preview(store)
        assert not record.runs and record.protected_runs["Run is busy"] == 1


def test_shared_original_transitive_reference_and_binary_checkpoint_are_retained(
    database, workflow
):
    _, request, original = terminal(database, workflow, content=b"leaf original")
    intermediary = ArtifactStore(database).put(
        ("references " + original.id).encode(), "intermediary.txt"
    )
    retained = ArtifactStore(database).put(
        ("references " + intermediary.id).encode(), "outside.txt"
    )
    # Both leaf and intermediary belong to the selected run. A non-candidate
    # original pins intermediary, which transitively pins the leaf.
    with database.connection() as conn:
        conn.execute(
            "INSERT INTO research_attempts (id,run_id,path,stage,model,status,input_artifact_id) "
            "VALUES (%s,%s,'synthetic','hypothesize','synthetic','failed',%s)",
            (uuid4(), request.id, intermediary.id),
        )
    store = RetentionStore(database)
    record = preview(store)
    assert not record.originals and record.retained_originals == 2
    apply(store, record)
    assert ArtifactStore(database).get(original.id)
    assert ArtifactStore(database).get(retained.id)


def test_surviving_binary_checkpoints_pin_originals(database, workflow):
    _, request, original = terminal(database, workflow)
    other, other_request = setup_queue(database, workflow)
    other.runs.start(other_request)
    with database.connection() as conn:
        conn.execute(
            "INSERT INTO checkpoint_blobs (thread_id,checkpoint_ns,channel,version,type,blob) "
            "VALUES (%s,'','synthetic','1','msgpack',%s)",
            (str(other_request.id), b"\x80" + original.id.encode() + b"\x00"),
        )
    record = preview(RetentionStore(database))
    assert [r.run_id for r in record.runs] == [request.id]
    assert not record.originals and record.retained_originals == 1


def test_new_reference_invalidates_whole_preview_and_valid_reupload_clears_address_tombstone(
    database, workflow
):
    _, request, original = terminal(database, workflow)
    store = RetentionStore(database)
    first = preview(store)
    ArtifactStore(database).put(("keep " + original.id).encode(), "pin.txt")
    with pytest.raises(RetentionError, match="references changed"):
        apply(store, first)
    assert RunStore(database).get(request.id).status == "cancelled"
    second = preview(store)
    assert not second.originals
    apply(store, second)
    # Independent original deletion permits a later real upload with the same hash.
    _, fresh, unused = terminal(database, workflow, content=b"fresh only")
    third = preview(store)
    apply(store, third)
    with database.connection() as conn:
        with pytest.raises(psycopg.DatabaseError) as error:
            conn.execute(
                "INSERT INTO evaluation_archives (id,content_hash,document) VALUES (%s,%s,%s)",
                (uuid4(), uuid4().hex, Jsonb({"generation_input_hash": unused.id})),
            )
        assert error.value.sqlstate == "RC002"
    recreated = ArtifactStore(database).put(b"fresh only", "fresh.txt")
    assert recreated.id == unused.id
    with database.connection() as conn:
        assert not conn.execute(
            "SELECT 1 FROM retention_artifact_tombstones WHERE artifact_id=%s", (unused.id,)
        ).fetchone()
        conn.execute(
            "INSERT INTO evaluation_archives (id,content_hash,document) VALUES (%s,%s,%s)",
            (uuid4(), uuid4().hex, Jsonb({"content_hash": recreated.id})),
        )


def test_stale_creator_cannot_commit_a_deleted_run_reference(database, workflow):
    _, request, _ = terminal(database, workflow)
    store = RetentionStore(database)
    record = preview(store)
    read = Event()
    proceed = Event()

    def delayed_creator():
        with database.connection() as conn, conn.transaction():
            assert conn.execute("SELECT 1 FROM runs WHERE id=%s", (request.id,)).fetchone()
            read.set()
            assert proceed.wait(10)
            conn.execute(
                "INSERT INTO evaluation_archives (id,content_hash,document) VALUES (%s,%s,%s)",
                (uuid4(), uuid4().hex, Jsonb({"nested": [{"run_id": str(request.id)}]})),
            )

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(delayed_creator)
        assert read.wait(5)
        try:
            apply(store, record)
        finally:
            proceed.set()
        with pytest.raises(psycopg.DatabaseError) as error:
            future.result(10)
        assert error.value.sqlstate == "RC001"
    assert len(store.history()) == 1


def test_committing_reference_writer_blocks_cleanup_then_invalidates_preview(database, workflow):
    _, request, _ = terminal(database, workflow)
    store = RetentionStore(database)
    record = preview(store)
    with database.connection() as writer, writer.transaction():
        writer.execute(
            "INSERT INTO evaluation_archives (id,content_hash,document) VALUES (%s,%s,%s)",
            (uuid4(), uuid4().hex, Jsonb({"run_id": str(request.id)})),
        )
        with pytest.raises(RetentionError) as error:
            apply(store, record)
        assert error.value.status == 429
    with pytest.raises(RetentionError, match="protected"):
        apply(store, record)
    assert not store.history()


def test_changed_state_expiry_and_wrong_digest_never_delete(database, workflow, monkeypatch):
    _, request, _ = terminal(database, workflow)
    store = RetentionStore(database)
    record = preview(store)
    with pytest.raises(RetentionError, match="does not match"):
        store.apply(record.id, RetentionConfirm(digest="0" * 64, confirmation="DELETE"))
    with database.connection() as conn:
        conn.execute("UPDATE run_controls SET reason='new state' WHERE run_id=%s", (request.id,))
    with pytest.raises(RetentionError, match="changed"):
        apply(store, record)
    fresh = preview(store)
    monkeypatch.setattr(
        store,
        "_preview",
        lambda conn, key: fresh.model_copy(
            update={"expires_at": fresh.created_at - timedelta(seconds=1)}
        ),
    )
    with pytest.raises(RetentionError, match="expired"):
        apply(store, fresh)
    assert RunStore(database).get(request.id).status == "cancelled"


def test_immutable_updates_and_nonselected_deletes_remain_forbidden(database, workflow):
    _, request, original = terminal(database, workflow)
    with database.connection() as conn, conn.transaction():
        conn.execute(
            "SELECT set_config('researchchain.retention_deletions',%s,true)",
            (
                json.dumps(
                    {
                        "schema": database.schema,
                        "run_ids": [str(request.id)],
                        "artifact_ids": [original.id],
                    }
                ),
            ),
        )
        for statement, params in [
            ("UPDATE runs SET brief='changed' WHERE id=%s", (request.id,)),
            ("UPDATE artifact_blobs SET name='changed' WHERE id=%s", (original.id,)),
            ("DELETE FROM workflow_revisions", ()),
        ]:
            with pytest.raises(psycopg.IntegrityError), conn.transaction():
                conn.execute(statement, params)
        conn.execute(
            "SELECT set_config('researchchain.retention_deletions',%s,true)",
            (
                json.dumps(
                    {
                        "schema": "another_workspace",
                        "run_ids": [str(request.id)],
                        "artifact_ids": [original.id],
                    }
                ),
            ),
        )
        with pytest.raises(psycopg.IntegrityError), conn.transaction():
            conn.execute("DELETE FROM artifact_blobs WHERE id=%s", (original.id,))


def test_api_requires_owner_csrf_matching_preview_and_explicit_confirmation(database, workflow):
    _, request, _ = terminal(database, workflow)
    app = create_app(database)
    with TestClient(
        app,
        base_url=app.state.access.config.origin,
        headers={"Origin": app.state.access.config.origin},
    ) as client:
        assert client.post("/api/retention/previews", json={}).status_code == 401
        assert client.get("/api/retention/receipts").status_code == 401
    with owner_client(app, workers=False) as client:
        create = {"id": str(uuid4()), "older_than_days": 0}
        saved = client.post("/api/retention/previews", json=create)
        assert saved.status_code == 201
        record = saved.json()
        url = f"/api/retention/previews/{record['id']}/apply"
        assert (
            client.post(url, json={"digest": record["digest"], "confirmation": "yes"}).status_code
            == 422
        )
        csrf = client.headers.pop("X-ResearchChain-CSRF")
        assert (
            client.post(
                url, json={"digest": record["digest"], "confirmation": "DELETE"}
            ).status_code
            == 403
        )
        client.headers["X-ResearchChain-CSRF"] = csrf
        result = client.post(url, json={"digest": record["digest"], "confirmation": "DELETE"})
        assert result.status_code == 200 and result.json()["run_ids"] == [str(request.id)]
        assert (
            client.post(url, json={"digest": record["digest"], "confirmation": "DELETE"}).json()
            == result.json()
        )
        assert client.get(f"/api/runs/{request.id}").status_code == 410


def test_creation_cutoff_batch_limit_and_durable_job_cleanup(database, workflow):
    from researchchain.worker import RunWorker

    queue, first = setup_queue(database, workflow)
    queue.start(first)
    assert RunWorker(queue.runs).run_once()
    queue.runs.cancel(first.id)
    _, second, _ = terminal(database, workflow)
    store = RetentionStore(database)
    assert not store.preview(RetentionRequest(id=uuid4(), older_than_days=30)).runs
    record = preview(store, max_runs=1)
    assert [r.run_id for r in record.runs] == [first.id]
    assert record.more_eligible == 1
    receipt = apply(store, record)
    assert receipt.deleted_rows["run_jobs"] == 1
    assert [r.run_id for r in preview(store).runs] == [second.id]


def test_busy_run_never_deadlocks_a_writer_waiting_for_retention(database, workflow, monkeypatch):
    import researchchain.retention as module

    _, request, _ = terminal(database, workflow)
    store = RetentionStore(database)
    record = preview(store)
    reached = Event()
    proceed = Event()
    lock = module.lock_run

    def during_lock(conn, run_id):
        reached.set()
        assert proceed.wait(10)
        return lock(conn, run_id)

    monkeypatch.setattr(module, "lock_run", during_lock)
    with database.connection() as writer, ThreadPoolExecutor(max_workers=2) as pool:
        writer.execute("SELECT pg_advisory_lock(hashtextextended(%s,0))", (f"run:{request.id}",))
        deleting = pool.submit(apply, store, record)
        assert reached.wait(10)
        updating = pool.submit(
            writer.execute,
            "UPDATE run_controls SET reason='concurrent cancellation' WHERE run_id=%s",
            (request.id,),
        )
        try:
            proceed.set()
            with pytest.raises(RetentionError, match="protected"):
                deleting.result(10)
            assert updating.result(10).rowcount == 1
        finally:
            proceed.set()
    assert not store.history()


def test_writer_waiting_behind_cleanup_sees_committed_tombstone(database, workflow, monkeypatch):
    import researchchain.retention as module

    _, request, _ = terminal(database, workflow)
    store = RetentionStore(database)
    record = preview(store)
    reached = Event()
    proceed = Event()
    submitting = Event()
    fingerprint = module.run_fingerprint

    def during_recheck(conn, run_id):
        reached.set()
        assert proceed.wait(10)
        return fingerprint(conn, run_id)

    monkeypatch.setattr(module, "run_fingerprint", during_recheck)

    def late_writer():
        with database.connection() as conn:
            submitting.set()
            conn.execute(
                "INSERT INTO evaluation_archives (id,content_hash,document) VALUES (%s,%s,%s)",
                (uuid4(), uuid4().hex, Jsonb({"run_id": str(request.id)})),
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        deleting = pool.submit(apply, store, record)
        assert reached.wait(10)
        writing = pool.submit(late_writer)
        try:
            assert submitting.wait(5)
            proceed.set()
            assert deleting.result(10).run_ids == [request.id]
            with pytest.raises(psycopg.DatabaseError) as error:
                writing.result(10)
            assert error.value.sqlstate == "RC001"
        finally:
            proceed.set()


def test_failure_after_deletion_rolls_back_records_bytes_and_tombstones(
    database, workflow, monkeypatch
):
    from researchchain.retention_models import RetentionReceipt

    runs, request, original = terminal(database, workflow)
    store = RetentionStore(database)
    record = preview(store)

    def failure(*args, **kwargs):
        raise RuntimeError("Synthetic receipt write failure")

    with monkeypatch.context() as patch:
        patch.setattr(RetentionReceipt, "model_dump", failure)
        with pytest.raises(RuntimeError, match="receipt write"):
            apply(store, record)
    assert runs.get(request.id).status == "cancelled"
    assert ArtifactStore(database).get(original.id)
    assert not store.history()
    with database.connection() as conn:
        assert not conn.execute("SELECT 1 FROM retention_run_tombstones").fetchone()
        assert not conn.execute("SELECT 1 FROM retention_artifact_tombstones").fetchone()
    assert apply(store, record).run_ids == [request.id]


def test_reference_guards_follow_target_schema_not_callers_search_path(database, workflow):
    from test_access_api import second_workspace

    _, request, _ = terminal(database, workflow)
    store = RetentionStore(database)
    record = preview(store)
    apply(store, record)
    with second_workspace(database) as other:
        revision = RevisionStore(other).save(Workflow.model_validate(workflow))
        with database.connection() as conn:
            # The caller is in the deleted run's workspace, but this insert targets
            # a different workspace. Its independent run ID remains available.
            conn.execute(
                sql.SQL(
                    "INSERT INTO {}.runs (id,revision_id,compiler_version,brief) "
                    "VALUES (%s,%s,'test','safe')"
                ).format(sql.Identifier(other.schema)),
                (request.id, revision.id),
            )
            conn.execute(
                sql.SQL(
                    "INSERT INTO {}.evaluation_archives (id,content_hash,document) "
                    "VALUES (%s,%s,%s)"
                ).format(sql.Identifier(other.schema)),
                (uuid4(), uuid4().hex, Jsonb({"run_id": str(request.id)})),
            )
        with other.connection() as conn:
            conn.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(database.schema)))
            assert (
                conn.execute(
                    sql.SQL("SELECT count(*) AS n FROM {}.runs").format(
                        sql.Identifier(other.schema)
                    )
                ).fetchone()["n"]
                == 1
            )
        assert not RetentionStore(other).history()


def test_backup_restore_preserves_cleanup_receipt_and_nonresurrection(
    database, workflow, tmp_path, restore_target
):
    from psycopg.conninfo import make_conninfo

    from researchchain.backup import create_backup
    from researchchain.backup_restore import restore_backup

    _, request, _ = terminal(database, workflow)
    store = RetentionStore(database)
    record = preview(store)
    receipt = apply(store, record)
    folder = tmp_path / "retention-backup"
    create_backup(database, folder)
    restore_backup(database, folder, restore_target, trusted=True)
    restored = Database(make_conninfo(database.url, dbname=restore_target), database.schema)
    assert RetentionStore(restored).get(record.id).receipt == receipt
    assert apply(RetentionStore(restored), record) == receipt
    with pytest.raises(RetentionError) as error:
        RunStore(restored).start(request)
    assert error.value.status == 410


@pytest.mark.parametrize("isolation", ["REPEATABLE READ", "SERIALIZABLE"])
def test_snapshot_isolated_writer_is_rejected_instead_of_missing_tombstone(
    database, workflow, isolation
):
    _, request, _ = terminal(database, workflow)
    store = RetentionStore(database)
    record = preview(store)
    with database.connection() as writer, writer.transaction():
        writer.execute(sql.SQL("SET TRANSACTION ISOLATION LEVEL " + isolation))
        assert writer.execute("SELECT 1 FROM runs WHERE id=%s", (request.id,)).fetchone()
        apply(store, record)
        with pytest.raises(psycopg.DatabaseError) as error, writer.transaction():
            writer.execute(
                "INSERT INTO evaluation_archives (id,content_hash,document) VALUES (%s,%s,%s)",
                (uuid4(), uuid4().hex, Jsonb({"run_id": str(request.id)})),
            )
        assert error.value.sqlstate == "25001"
