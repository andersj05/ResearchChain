from uuid import uuid4

from swarm_browser_fixture import result
from test_research_contracts import result_document
from test_research_swarm import SwarmProvider, delegate, finish, packets

from researchchain.dispatch import RunQueue
from researchchain.graph import MAX_RESEARCH_CALLS
from researchchain.research_sessions import ResearchSessionStart, session_setup
from researchchain.runtime import RunStore
from researchchain.worker import RunWorker


class AdaptiveProvider(SwarmProvider):
    async def complete(self, manifest, prepared, on_delta):
        packet = packets(prepared.input_items)
        if "swarm_lead" in packet:
            assert "max_turns" not in packet["swarm_lead"]
        delegation = packet.get("swarm_delegation")
        if delegation and delegation["worker_index"] == 1:
            assert prepared.web_search == "auto"
            assert "Use live web search throughout" in prepared.instructions
            assert "another investigation" in prepared.instructions
            receipts = sum(
                item.get("type") == "function_call_output" for item in prepared.input_items
            )
            if receipts < 6:
                return result(
                    prepared.model,
                    tool="pursue_lead",
                    arguments={
                        "lead": f"Check observation {receipts + 1}.",
                        "findings": "The current observation needs independent verification.",
                        "sec_lookup": None,
                    },
                )
        if "report_markdown" in prepared.schema["properties"]:
            assert prepared.model == "analysis-model"
            answer = result_document("custom")
            answer.update(hypotheses=[], report_markdown="# Synthetic report\n\nCompleted work.")
            return result(prepared.model, answer=answer)
        return await super().complete(manifest, prepared, on_delta)


def test_adaptive_swarm_can_finish_after_the_former_desk_limits(database):
    def decision(state):
        if state["turn"] <= 7:
            return delegate(1, objective=f"Investigate observation {state['turn']}.")
        return finish()

    provider = AdaptiveProvider(decision)
    store = RunStore(database, provider)
    queue = RunQueue(store)
    request = ResearchSessionStart(
        id=uuid4(),
        brief="Investigate the synthetic observations.",
        model="test-model",
        lead={"model": "analysis-model"},
        editor={"model": "analysis-model"},
        provider_account_id="oaiapp_fixture",
        swarm={"lead_count": 1, "researchers_per_lead": 8, "max_lead_turns": None},
        max_passes=None,
        max_active_seconds=None,
        review_mode="never",
        web_search=True,
    )
    start = queue.start_session(request)
    assert queue.start_session(request) == start
    with database.connection() as conn:
        conn.execute(
            "UPDATE run_controls SET active_seconds = 4000 WHERE run_id = %s", (start.run_id,)
        )
    assert RunWorker(store).run_once()
    done = store.get(start.run_id)
    assert done.status == "completed", done.stop_reason
    assert done.usage.active_seconds > 4000
    assert done.research_manifest.settings.limits.max_model_calls == MAX_RESEARCH_CALLS
    assert any(attempt.path == "root/team/lead-1/turn-8" for attempt in done.model_attempts)
    assert any(attempt.path.endswith("agent-1/analyst-pass-7") for attempt in done.model_attempts)
    assert session_setup(done).model_dump() == request.model_dump(
        exclude={"id", "provider_account_id"}
    )
