import json
from dataclasses import replace
from uuid import uuid4

import pytest
from access_fixtures import owner_client
from pydantic import ValidationError
from test_research_runtime import FakeProvider, approve

from researchchain.artifacts import read_content
from researchchain.graph import Workflow
from researchchain.main import create_app
from researchchain.models import RunRequest
from researchchain.research import make_manifest
from researchchain.research_directions import record_direction
from researchchain.research_models import OwnerDirectionInput
from researchchain.research_session_export import export_session_report
from researchchain.research_sessions import ResearchSessionStart, session_workflow
from researchchain.revisions import ConflictError, NotFoundError, RevisionStore
from researchchain.runtime import RunStore, compiler_version
from researchchain.worker import RunWorker


class SessionProvider(FakeProvider):
    async def complete(self, manifest, prepared, on_delta):
        completion = await super().complete(manifest, prepared, on_delta)
        if "assignments" in prepared.schema["properties"]:
            plan = {
                "assignments": [{"title": "Pricing", "objective": "Compare the supplied prices."}],
                "review_question": None,
            }
            return replace(completion, text=json.dumps(plan))
        if "review_question" in prepared.schema["properties"]:
            result = json.loads(completion.text)
            result["review_question"] = (
                "Which horizon should the editor use?"
                if "Ambiguous horizon" in str(prepared.input_items)
                else None
            )
            return replace(completion, text=json.dumps(result))
        if "report_markdown" in prepared.schema["properties"]:
            packet = json.loads(prepared.input_items[0]["content"][0]["text"])
            result = json.loads(completion.text)
            result["report_markdown"] = (
                None
                if packet["brief"] == "No report"
                else "# Synthetic report\n\n"
                + "Verified synthetic observation. " * 240
                + "\n\n"
                + packet["human_feedback"]
            )
            return replace(completion, text=json.dumps(result))
        return completion


def request(**updates):
    return ResearchSessionStart(
        id=uuid4(),
        model="test-model",
        provider_account_id="oaiapp_fixture",
        **{"brief": "Ambiguous horizon", "style_excerpt": "Style sample sentinel.", **updates},
    )


def test_swarm_capacity_roles_and_revised_setup_are_pinned_before_execution(database):
    original = request(
        swarm={
            "lead_count": 4,
            "researchers_per_lead": 20,
            "max_parallel": 20,
            "max_lead_turns": 12,
            "allow_consultations": True,
        },
        max_input_bytes=8_000_000,
        max_passes=12,
        review_mode="never",
        lead={"model": "analysis-model", "reasoning_effort": "xhigh"},
        researcher={"model": "test-model", "reasoning_effort": "low"},
    )
    graph = session_workflow(original)
    assert compiler_version(graph) == "research-swarm-1"
    assert compiler_version(session_workflow(request())) == "research-team-1"
    assert session_workflow(request()).research.limits.max_input_bytes == 4_000_000
    assert graph.research.limits.max_input_bytes == original.max_input_bytes
    assert graph.budgets.max_concurrency == 20
    assert graph.research.limits.max_model_calls == 1 + 4 * 12 + 81 * 12
    assert graph.research.limits.max_tool_calls == graph.research.limits.max_model_calls
    assert graph.nodes[0].config.team.swarm == original.swarm
    assert graph.nodes[0].config.team.lead == original.lead
    assert graph.nodes[0].config.team.researcher == original.researcher
    assert "judgment" not in [node.id for node in graph.nodes]

    provider = SessionProvider()
    url = "/api/research-sessions"
    payload = original.model_dump(mode="json")
    with owner_client(create_app(database, provider), workers=False) as client:
        first = client.post(url, json=payload)
        assert first.status_code == 202, first.text
        assert client.post(url, json=payload).json() == first.json()
        setup = client.get(f"{url}/{original.id}/setup").json()
        assert setup == original.model_dump(mode="json", exclude={"id", "provider_account_id"})
        changes = {**payload, "swarm": {**setup["swarm"], "max_parallel": 2}}
        assert client.post(url, json=changes).status_code == 409
        revised = {**changes, "id": str(uuid4()), "baseline_run_id": str(original.id)}
        assert client.post(url, json=revised).status_code == 202
        assert client.get(f"{url}/{revised['id']}/setup").json()["swarm"]["max_parallel"] == 2
        assert client.get(f"{url}/{original.id}/setup").json() == setup
    assert not provider.calls


@pytest.mark.parametrize(
    "invalid",
    [
        {"lead_count": 5},
        {"researchers_per_lead": 21},
        {"max_parallel": 0},
        {"max_parallel": 21},
        {"max_lead_turns": 1},
        {"max_lead_turns": 13},
    ],
)
def test_research_sessions_enforce_swarm_bounds(invalid):
    with pytest.raises(ValidationError):
        request(swarm=invalid)


def test_larger_run_limits_require_an_executable_swarm(database):
    standard = session_workflow(request(review_mode="never")).model_dump(mode="json")
    swarm = session_workflow(request(swarm={}, review_mode="never")).model_dump(mode="json")
    ref = {"id": "study", "version": 1}
    call = {
        "id": "study",
        "kind": "subgraph",
        "label": "Run study",
        "position": {"x": 0, "y": 0},
        "config": {"type": "subgraph", "ref": ref},
    }
    document = {
        **standard,
        "start_node": "study",
        "nodes": [call, standard["nodes"][-1]],
        "edges": [{"source": "study", "target": "finish"}],
        "subgraphs": [
            {
                "id": "study",
                "version": version,
                **{k: body[k] for k in ("name", "start_node", "nodes", "edges")},
            }
            for version, body in enumerate([standard, swarm], start=1)
        ],
    }
    document["research"]["limits"].update(max_model_calls=100, max_tool_calls=100)
    document["budgets"]["max_concurrency"] = 16
    archived = Workflow.model_validate(document)
    assert compiler_version(archived) == "research-team-1"
    with database.connection() as conn:
        manifest = make_manifest(conn, archived, uuid4(), [], SessionProvider().account)
    assert "swarm_version" not in manifest.tool_config
    document["research"]["limits"].update(max_model_calls=101, max_tool_calls=101)
    document["budgets"]["max_concurrency"] = 17
    with pytest.raises(ValidationError) as rejected:
        Workflow.model_validate(document)
    assert {error["loc"] for error in rejected.value.errors()} == {
        ("research", "limits", "max_model_calls"),
        ("research", "limits", "max_tool_calls"),
        ("budgets", "max_concurrency"),
    }
    ref["version"] = 2
    assert compiler_version(Workflow.model_validate(document)) == "research-swarm-1"


def test_brief_admission_is_atomic_and_retryable_and_only_the_editor_gets_style(database):
    provider = SessionProvider()
    runs = RunStore(database, provider)
    worker = RunWorker(runs)
    original = request()
    payload = original.model_dump(mode="json")
    with owner_client(create_app(database, provider), workers=False) as client:
        path = "/api/research-sessions"
        first = client.post(path, json=payload)
        assert first.status_code == 202, first.text
        assert client.post(path, json=payload).json() == first.json()
        assert client.post(path, json={**payload, "max_agents": 4}).status_code == 409
        assert client.post(path, json={**payload, "max_passes": 1}).status_code == 422
        assert client.get(path).json()[0]["id"] == str(original.id)
        setup = client.get(f"{path}/{original.id}/setup").json()
        assert setup == original.model_dump(mode="json", exclude={"id", "provider_account_id"})
        assert not provider.calls
        assert worker.run_once()
        paused = runs.get(original.id)
        assert (
            paused.status == "paused"
            and paused.review.question == "Which horizon should the editor use?"
        )
        feedback = "Use the one-year horizon."
        decision = approve(paused, feedback)
        assert (
            client.post(f"/api/runs/{original.id}/resume", json=decision.model_dump()).status_code
            == 202
        )
        assert worker.run_once()
        done = runs.get(original.id)
        assert done.status == "completed"
        assert [a.path for a in done.model_attempts] == [
            "root/team/plan",
            "root/team/agent-1",
            "root/report",
        ]
        assert all(
            original.style_excerpt not in str(call.request_body()) for call in provider.calls[:-1]
        )
        packet = json.loads(provider.calls[-1].input_items[0]["content"][0]["text"])
        assert packet["writing_style_reference"] == original.style_excerpt
        assert packet["human_feedback"] == feedback
        assert json.loads(packet["additional_context"])["agents"][0]["title"] == "Pricing"
        assert packet["sources"] == []
        final = done.model_attempts[-1]
        report = final.result.report_artifact
        assert report.name == "report.md" and final.result.workspace_files == [report]
        with database.connection() as conn:
            content = read_content(conn, report.artifact_id).decode()
            response = json.loads(read_content(conn, final.response_artifact_id))
            assert content == json.loads(response["model_text"])["report_markdown"]
        assert len(content) > 6000 and content.endswith(feedback)
        assert all(
            "report_markdown" not in call.schema["properties"] for call in provider.calls[:-1]
        )
        revised = request(brief="Second experiment", baseline_run_id=original.id)
        assert client.post(path, json=revised.model_dump(mode="json")).status_code == 202
        assert runs.get(revised.id).baseline_run_id == original.id
        assert runs.get(original.id).brief == original.brief
        # An ordinary workflow with the same graph is still a separate kind of start.
        ordinary_id = str(uuid4())
        assert (
            client.post(
                "/api/runs",
                json={
                    "id": ordinary_id,
                    "revision_id": str(done.revision_id),
                    "brief": "Workflow experiment",
                    "provider_account_id": provider.account.id,
                },
            ).status_code
            == 202
        )
        assert client.get(f"{path}/{ordinary_id}/setup").status_code == 404
        assert {row["id"] for row in client.get(path).json()} == {str(original.id), str(revised.id)}
        archive = client.get("/api/runs/search?sessions_only=true").json()["items"]
        assert {item["run"]["id"] for item in archive} == {str(original.id), str(revised.id)}
        with database.connection() as conn:
            assert (
                conn.execute("SELECT count(*) AS count FROM workflow_revisions").fetchone()["count"]
                == 1
            )


def test_session_model_choices_round_trip_and_reach_each_role(database):
    provider = SessionProvider()
    runs = RunStore(database, provider)
    start = request(
        review_mode="never",
        reasoning_effort="high",
        verbosity="low",
        lead={"reasoning_effort": "low"},
        researcher={
            "model": "analysis-model",
            "reasoning_effort": "xhigh",
            "verbosity": "model_default",
        },
        editor={"reasoning_effort": "model_default", "verbosity": "high"},
    )
    url = "/api/research-sessions"
    payload = start.model_dump(mode="json")
    with owner_client(create_app(database, provider), workers=False) as client:
        queued = client.post(url, json=payload)
        assert queued.status_code == 202, queued.text
        assert client.post(url, json=payload).json() == queued.json()
        assert (
            client.post(url, json={**payload, "lead": {"reasoning_effort": "high"}}).status_code
            == 409
        )
        assert not provider.calls
        assert RunWorker(runs).run_once()
        run = runs.get(start.id)
        assert run.status == "completed", run.stop_reason
        expected = {
            "root/team/plan": ("test-model", "low", "low"),
            "root/team/agent-1": ("analysis-model", "xhigh", None),
            "root/report": ("test-model", None, "high"),
        }
        assert {item.path for item in run.model_attempts} == expected.keys()
        with database.connection() as conn:
            for attempt in run.model_attempts:
                body = json.loads(read_content(conn, attempt.input_artifact_id))
                assert (
                    body["model"],
                    body.get("reasoning", {}).get("effort"),
                    body["text"].get("verbosity"),
                ) == expected[attempt.path]
                assert body["text"]["format"]["strict"] is True
        setup = client.get(f"{url}/{start.id}/setup").json()
        assert setup == start.model_dump(mode="json", exclude={"id", "provider_account_id"})
        revised = {
            **payload,
            **setup,
            "id": str(uuid4()),
            "baseline_run_id": str(start.id),
            "editor": {},
        }
        assert client.post(url, json=revised).status_code == 202
        revised_setup = client.get(f"{url}/{revised['id']}/setup").json()
        assert revised_setup.get("editor") is None
        assert (
            revised_setup["lead"] == setup["lead"]
            and revised_setup["researcher"] == setup["researcher"]
        )
        assert client.get(f"{url}/{start.id}/setup").json() == setup


@pytest.mark.parametrize(
    ("mode", "brief", "status"),
    [
        ("when_needed", "Clear brief", "completed"),
        ("always", "Clear brief", "paused"),
        ("never", "Ambiguous horizon", "completed"),
    ],
)
def test_session_review_policy_uses_actual_questions(database, mode, brief, status):
    provider = SessionProvider()
    runs = RunStore(database, provider)
    with owner_client(create_app(database, provider), workers=False) as client:
        start = request(brief=brief, review_mode=mode)
        assert (
            client.post("/api/research-sessions", json=start.model_dump(mode="json")).status_code
            == 202
        )
        assert RunWorker(runs).run_once()
        run = runs.get(start.id)
        assert run.status == status, run.stop_reason
        if mode == "when_needed":
            event = next(event for event in run.events if event.kind == "review")
            assert event.review_response is None
        if mode == "always":
            assert "What should the editor" in run.review.question


def test_review_questions_require_an_actual_upstream_team():
    workflow = session_workflow(request()).canonical_document()
    del workflow["nodes"][0]["config"]["team"]
    with pytest.raises(ValidationError, match="Only a research team"):
        Workflow.model_validate(workflow)


def test_session_cannot_finish_without_its_report_and_retains_editor_response(database):
    provider = SessionProvider()
    runs = RunStore(database, provider)
    with owner_client(create_app(database, provider), workers=False) as client:
        start = request(brief="No report", review_mode="never")
        assert (
            client.post("/api/research-sessions", json=start.model_dump(mode="json")).status_code
            == 202
        )
        assert RunWorker(runs).run_once()
        run = runs.get(start.id)
        assert run.status == "failed" and "nonempty report.md" in run.stop_reason
        final = run.model_attempts[-1]
        assert final.status == "failed" and final.path == "root/report"
        with database.connection() as conn:
            output = json.loads(read_content(conn, final.response_artifact_id))
        assert json.loads(output["model_text"])["report_markdown"] is None
        assert client.get(f"/api/research-sessions/{start.id}/report.zip").status_code == 409


@pytest.mark.parametrize("old_session", [False, True])
def test_ordinary_and_previous_session_editors_keep_original_result_schema(
    database, monkeypatch, old_session
):
    from researchchain import runtime
    from researchchain.research_sessions import SESSION_VERSION

    if old_session:
        original = runtime.make_manifest

        def older_manifest(*args, **kwargs):
            manifest = original(*args, **kwargs)
            manifest.tool_config["session"] = SESSION_VERSION
            return manifest

        monkeypatch.setattr(runtime, "make_manifest", older_manifest)
    provider = SessionProvider()
    runs = RunStore(database, provider)
    workflow = session_workflow(request(review_mode="never"))
    revision = RevisionStore(database).save(workflow)
    result = runs.start(
        RunRequest(
            id=uuid4(),
            brief="No report",
            revision_id=revision.id,
            provider_account_id=provider.account.id,
        )
    )
    assert result.status == "completed", result.stop_reason
    assert result.model_attempts[-1].result.report_artifact is None
    assert "report_markdown" not in provider.calls[-1].schema["properties"]
    if old_session:
        with pytest.raises(NotFoundError, match="did not save a Markdown file"):
            export_session_report(database, result.id)
    with pytest.raises(ConflictError if old_session else NotFoundError):
        record_direction(
            database, result.id, OwnerDirectionInput(id=uuid4(), text="A new direction.")
        )
