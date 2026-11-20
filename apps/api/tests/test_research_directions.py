"""Owner steering is journaled once and delivered only to newly reserved session passes."""

import json
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import uuid4

import pytest
from access_fixtures import owner_client
from psycopg.conninfo import make_conninfo
from psycopg.errors import LockNotAvailable
from test_research_sessions import SessionProvider, request
from test_research_team import TeamProvider

from researchchain.analyst_workspace import PythonRun
from researchchain.artifacts import read_content
from researchchain.backup import create_backup
from researchchain.backup_restore import restore_backup
from researchchain.database import Database
from researchchain.dispatch import RunQueue
from researchchain.main import create_app
from researchchain.research_directions import record_direction
from researchchain.research_models import OwnerDirectionInput
from researchchain.retention import RetentionStore
from researchchain.retention_models import RetentionConfirm, RetentionRequest
from researchchain.revisions import ConflictError
from researchchain.runtime import RunStore
from researchchain.worker import RunWorker


def packet(conn, attempt):
    original = json.loads(read_content(conn, attempt.input_artifact_id))
    return json.loads(original["input"][0]["content"][0]["text"])


def test_live_direction_changes_only_new_requests_and_survives_retries(database, monkeypatch):
    provider = TeamProvider(workspaces=True, hold=True)
    runs = RunStore(database, provider)
    original = request(brief="Compare two synthetic measures.", max_agents=2, review_mode="never")
    path = f"/api/research-sessions/{original.id}/directions"
    note = {"id": str(uuid4()), "text": "Focus on orders recorded after the revision."}

    def python_action(action, inputs, guard):
        guard()
        files = {"report.md": b"Full synthetic report."} if action.purpose == "Editor" else {}
        return PythonRun(0, "Synthetic tool action", files)

    monkeypatch.setattr("researchchain.research.run_python", python_action)
    with owner_client(create_app(database, provider), workers=False) as client:
        assert (
            client.post("/api/research-sessions", json=original.model_dump(mode="json")).status_code
            == 202
        )
        with ThreadPoolExecutor(max_workers=1) as pool:
            work = pool.submit(RunWorker(runs).run_once)
            try:
                assert provider.overlap.wait(15)
                before = runs.get(original.id)
                assert "owner_directions" not in before.model_dump()
                assert all(
                    "owner_direction_ids" not in a.model_dump() for a in before.model_attempts
                )
                accepted = client.post(path, json=note)
                assert accepted.status_code == 200, accepted.text
                direction = accepted.json()
                assert client.post(path, json=note).json() == direction
                assert (
                    client.post(path, json={**note, "text": "Modify saved note."}).status_code
                    == 409
                )
                active = client.get(f"/api/runs/{original.id}").json()
                assert active["owner_directions"] == [direction]
                assert len(provider.calls) == 3
            finally:
                provider.released.set()
            assert work.result(timeout=20)
        done = runs.get(original.id)
        assert done.status == "completed", done.stop_reason
        assert len(provider.calls) == len(done.model_attempts) == 7
        before_addresses = {a.path: a.input_artifact_id for a in before.model_attempts}
        with database.connection() as conn:
            for attempt in done.model_attempts:
                payload = packet(conn, attempt)
                if attempt.path in before_addresses:
                    assert attempt.input_artifact_id == before_addresses[attempt.path]
                    assert "owner_directions" not in payload and not attempt.owner_direction_ids
                else:
                    assert payload["owner_directions"] == [direction]
                    assert [str(n) for n in attempt.owner_direction_ids] == [note["id"]]
        assert client.post(path, json=note).json() == direction
        assert client.post(path, json={**note, "id": str(uuid4())}).status_code == 409
        client.cookies.clear()
        assert client.post(path, json=note).status_code == 401


def test_last_direction_and_first_editor_reservation_share_a_database_lock(database, monkeypatch):
    from researchchain import research

    provider = SessionProvider()
    runs = RunStore(database, provider)
    setup = request(brief="Unambiguous", review_mode="never")
    RunQueue(runs).start_session(setup)
    early = OwnerDirectionInput(id=uuid4(), text="Use the supplied industry classification.")
    record_direction(database, setup.id, early)
    arriving, accepted, locked, proceed = (Event() for _ in range(4))
    original = research.pin_directions
    reservations = []

    def pause_editor(conn, run_id):
        reservations.append(run_id)
        if len(reservations) == 3:  # one planner and one researcher precede the editor
            arriving.set()
            assert accepted.wait(10)
        directions = original(conn, run_id)
        if len(reservations) == 3:
            locked.set()
            assert proceed.wait(10)
        return directions

    monkeypatch.setattr(research, "pin_directions", pause_editor)
    with ThreadPoolExecutor(max_workers=2) as pool:
        worker = pool.submit(RunWorker(runs).run_once)
        final_note = OwnerDirectionInput(id=uuid4(), text="Present both sides of the comparison.")
        try:
            assert arriving.wait(15)
            saved = record_direction(database, setup.id, final_note)
            accepted.set()
            assert locked.wait(15)
            with database.connection() as connection, pytest.raises(LockNotAvailable):
                connection.execute(
                    "SELECT 1 FROM run_controls WHERE run_id=%s FOR UPDATE NOWAIT", (setup.id,)
                )
            # This new direction must lose to the reservation even before the editor's
            # 'preparing' row is visible to other database sessions.
            late = pool.submit(
                record_direction,
                database,
                setup.id,
                OwnerDirectionInput(
                    id=uuid4(),
                    text="Too late for the reserved editor.",
                ),
            )
        finally:
            accepted.set()
            proceed.set()
        with pytest.raises(ConflictError):
            late.result(timeout=10)
        assert worker.result(timeout=15)
    final = runs.get(setup.id)
    assert final.status == "completed", final.stop_reason
    assert final.owner_directions[-1] == saved
    with database.connection() as conn:
        for attempt in final.model_attempts[:2]:
            assert attempt.owner_direction_ids == [early.id]
            assert [n["text"] for n in packet(conn, attempt)["owner_directions"]] == [early.text]
        editor = final.model_attempts[-1]
        assert editor.path == "root/report" and editor.owner_direction_ids == [
            early.id,
            final_note.id,
        ]
        assert packet(conn, editor)["owner_directions"][-1] == saved.model_dump(mode="json")
    assert record_direction(database, setup.id, final_note) == saved


def test_directions_are_bounded_under_concurrent_writers_and_validate_before_storage(database):
    provider = SessionProvider()
    runs = RunStore(database, provider)
    setup = request()
    RunQueue(runs).start_session(setup)

    def append(_):
        try:
            return record_direction(
                database, setup.id, OwnerDirectionInput(id=uuid4(), text="More context.")
            )
        except ConflictError:
            return None

    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(append, range(26)))
    assert sum(note is not None for note in responses) == 24
    notes = runs.get(setup.id).owner_directions
    assert len({note.id for note in notes}) == 24 and not provider.calls
    assert (
        record_direction(
            database, setup.id, OwnerDirectionInput(id=notes[0].id, text=notes[0].text)
        )
        == notes[0]
    )
    with owner_client(create_app(database, provider), workers=False) as client:
        path = f"/api/research-sessions/{setup.id}/directions"
        for bad in ("  \n ", "x" * 3001, "null\x00byte"):
            assert client.post(path, json={"id": str(uuid4()), "text": bad}).status_code == 422
        response = client.post(
            f"/api/research-sessions/{uuid4()}/directions",
            json={"id": str(uuid4()), "text": "Valid text"},
        )
        assert response.status_code == 404


def test_undeliverable_guidance_honors_pinned_byte_budget_and_has_no_request_receipt(
    database, monkeypatch
):
    from researchchain import dispatch

    session_workflow = dispatch.session_workflow

    def limited_workflow(setup):
        workflow = session_workflow(setup)
        workflow.research.limits.max_input_bytes = 16_000
        return workflow

    monkeypatch.setattr(dispatch, "session_workflow", limited_workflow)
    provider = SessionProvider()
    runs = RunStore(database, provider)
    setup = request()
    RunQueue(runs).start_session(setup)
    for _ in range(6):
        record_direction(database, setup.id, OwnerDirectionInput(id=uuid4(), text="x" * 3000))
    assert RunWorker(runs).run_once()
    done = runs.get(setup.id)
    assert done.status == "failed" and "input byte limit" in done.stop_reason
    assert len(done.owner_directions) == 6 and not provider.calls
    assert len(done.model_attempts) == 1
    attempt = done.model_attempts[0]
    assert attempt.path == "root/team/plan" and attempt.status == "failed"
    assert not attempt.owner_direction_ids and not attempt.input_artifact_id


def test_archiving_and_removing_a_completed_session_include_its_owner_directions(
    database, tmp_path, restore_target
):
    provider = SessionProvider()
    runs = RunStore(database, provider)
    setup = request(brief="Archive rehearsal", review_mode="never")
    RunQueue(runs).start_session(setup)
    note = OwnerDirectionInput(id=uuid4(), text="Filter the synthetic comparison by date.")
    direction = record_direction(database, setup.id, note)
    assert RunWorker(runs).run_once()
    original = runs.get(setup.id)
    assert original.status == "completed" and original.owner_directions == [direction]

    folder = tmp_path / "session-backup"
    create_backup(database, folder)
    receipt = restore_backup(database, folder, restore_target, trusted=True)
    assert receipt.provider_calls == 0
    restored = Database(make_conninfo(database.url, dbname=restore_target), database.schema)
    assert RunStore(restored).get(setup.id) == original
    assert record_direction(restored, setup.id, note) == direction
    with restored.connection() as conn:
        for attempt in original.model_attempts:
            assert attempt.owner_direction_ids == [note.id]
            assert packet(conn, attempt)["owner_directions"] == [direction.model_dump(mode="json")]

    retention = RetentionStore(database)
    preview = retention.preview(RetentionRequest(id=uuid4(), older_than_days=0))
    cleanup = retention.apply(
        preview.id, RetentionConfirm(digest=preview.digest, confirmation="DELETE")
    )
    assert cleanup.run_ids == [setup.id] and note.text not in cleanup.model_dump_json()
    with database.connection() as conn:
        assert not conn.execute(
            "SELECT 1 FROM run_controls WHERE run_id=%s", (setup.id,)
        ).fetchone()
        assert not conn.execute(
            "SELECT 1 FROM research_attempts WHERE run_id=%s", (setup.id,)
        ).fetchone()
