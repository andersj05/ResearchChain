import pytest
from access_fixtures import owner_client
from test_dispatch import setup_queue

from researchchain import compiler
from researchchain.main import create_app
from researchchain.models import LeadPerspective
from researchchain.research_perspectives import perspective_answers, request_perspectives
from researchchain.runtime import RunStore
from researchchain.worker import RunWorker


@pytest.mark.parametrize("reject", [False, True])
def test_independent_consultations_resume_the_right_lead_across_workers(
    database, workflow, monkeypatch, reject
):
    workflow.update(schema_version="0.3", nodes=[workflow["nodes"][0], workflow["nodes"][-1]])
    first, last = workflow["nodes"]
    workflow["edges"] = [{"source": first["id"], "source_port": "next", "target": last["id"]}]
    queue, request = setup_queue(database, workflow)
    original = compiler.node_function
    received = []

    def question(lead, turn):
        return LeadPerspective(
            action_path=f"root/team/lead-{lead}/turn-{turn}",
            lead_title=f"Lead {lead}",
            thesis="A synthetic interpretation.",
            question="Which period?",
            options=["One", "Two"],
        )

    def checkpoint_node(node, *args, **kwargs):
        normal = original(node, *args, **kwargs)
        if node.id != first["id"]:
            return normal

        def execute(state):
            answered = {}
            first_round = request_perspectives(
                request.id, node.id, [question(1, 2), question(2, 2)], answered
            )
            assert list(first_round) == [question(2, 2).action_path]
            # The second lead advances while the first lead is still waiting.
            next_round = request_perspectives(
                request.id, node.id, [question(1, 2), question(2, 4)], answered
            )
            assert list(next_round) == [question(1, 2).action_path]
            last_round = request_perspectives(request.id, node.id, [question(2, 4)], answered)
            received.append({**first_round, **next_round, **last_round})
            return normal(state)

        return execute

    monkeypatch.setattr(compiler, "node_function", checkpoint_node)
    queue.start(request)

    def worker():
        # Every invocation constructs a fresh graph, saver, store and worker.
        assert RunWorker(RunStore(database)).run_once()
        return RunStore(database).get(request.id)

    paused = worker()
    assert paused.status == "paused" and [r.path for r in paused.reviews] == [
        question(1, 2).action_path,
        question(2, 2).action_path,
    ]
    assert len({r.interrupt_id for r in paused.reviews}) == 2
    assert not RunWorker(RunStore(database)).run_once()
    with database.connection() as conn:
        assert (
            conn.execute(
                "SELECT active_started_at FROM run_controls WHERE run_id=%s", (request.id,)
            ).fetchone()["active_started_at"]
            is None
        )
    endpoint = f"/api/runs/{request.id}/resume"
    with owner_client(create_app(database), workers=False) as client:
        second = {
            "checkpoint_id": paused.checkpoint_id,
            "interrupt_id": paused.reviews[1].interrupt_id,
            "decision": "approve",
            "feedback": "Only the second period.",
        }
        assert client.post(endpoint, json={**second, "feedback": "  "}).status_code == 409
        assert client.post(endpoint, json={**second, "checkpoint_id": "stale"}).status_code == 409
        accepted = client.post(endpoint, json=second)
        assert accepted.status_code == 202
        assert (
            client.post(endpoint, json=second).json()["command_id"] == accepted.json()["command_id"]
        )
        remaining = worker()
        assert remaining.reviews[0].interrupt_id == paused.reviews[0].interrupt_id
        assert remaining.reviews[1].path == question(2, 4).action_path
        assert (
            client.post(endpoint, json={**second, "feedback": "Changed reply"}).status_code == 409
        )
        first_reply = {
            "checkpoint_id": remaining.checkpoint_id,
            "interrupt_id": remaining.review.interrupt_id,
            "decision": "reject" if reject else "approve",
            "feedback": "Use both periods.",
        }
        assert client.post(endpoint, json=first_reply).status_code == 202
        next_round = worker()
        if reject:
            assert next_round.status == "rejected" and not next_round.reviews and not received
            return
        assert (
            next_round.status == "paused" and next_round.review.path == question(2, 4).action_path
        )
        assert next_round.review.interrupt_id not in {r.interrupt_id for r in paused.reviews}
        final = {
            "checkpoint_id": next_round.checkpoint_id,
            "interrupt_id": next_round.review.interrupt_id,
            "decision": "approve",
            "feedback": "Account for seasonality.",
        }
        assert client.post(endpoint, json=final).status_code == 202
        assert worker().status == "completed"
        assert (
            client.post(endpoint, json=second).json()["command_id"] == accepted.json()["command_id"]
        )
        assert not RunWorker(RunStore(database)).run_once()
    assert received == [
        {
            question(1, 2).action_path: first_reply["feedback"],
            question(2, 2).action_path: second["feedback"],
            question(2, 4).action_path: final["feedback"],
        }
    ]
    with database.connection() as conn:
        recorded = perspective_answers(conn, request.id, received[0])
    assert {a.action_path: a.feedback for a in recorded} == received[0]
