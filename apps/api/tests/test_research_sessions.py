import json
from dataclasses import replace
from uuid import uuid4

import pytest
from access_fixtures import owner_client
from pydantic import ValidationError
from test_research_runtime import FakeProvider, approve

from researchchain.graph import Workflow
from researchchain.main import create_app
from researchchain.research_sessions import ResearchSessionStart, session_workflow
from researchchain.runtime import RunStore
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
        return completion


def request(**updates):
    return ResearchSessionStart(
        id=uuid4(),
        model="test-model",
        provider_account_id="oaiapp_fixture",
        **{"brief": "Ambiguous horizon", "style_excerpt": "Style sample sentinel.", **updates},
    )


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
        with database.connection() as conn:
            assert (
                conn.execute("SELECT count(*) AS count FROM workflow_revisions").fetchone()["count"]
                == 1
            )


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
