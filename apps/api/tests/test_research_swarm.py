"""Durable independent lead decisions, actual tool dispatch, worker limits and replay."""

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
from uuid import uuid4

import httpx
import pytest
from graph_fixtures import chain, node
from swarm_browser_fixture import result
from test_research_contracts import result_document
from test_research_runtime import FakeProvider
from test_research_team import analyst

from researchchain.artifacts import read_content
from researchchain.evidence import EvidenceStore
from researchchain.evidence_models import EvidenceCreate
from researchchain.graph import Workflow
from researchchain.models import ResumeRequest, RunRequest
from researchchain.providers.chatgpt_auth import ChatGPTAuth
from researchchain.research import ChatGPTResearchProvider
from researchchain.revisions import RevisionStore
from researchchain.runtime import RunStore
from researchchain.sec_financials import SecFinancials


def packets(items):
    data = {}
    for item in items:
        for part in item.get("content", []):
            if isinstance(part, dict) and part.get("type") == "input_text":
                try:
                    packet = json.loads(part["text"])
                except ValueError:
                    continue
                if isinstance(packet, dict):
                    data.update(packet)
    return data


def delegate(count, lead=1, objective="Test the independently supplied observation."):
    return "delegate", {
        "rationale": "Check each independent measure.",
        "assignments": [
            {"title": f"Measure {lead}.{i}", "objective": f"{objective} Measurement {i}."}
            for i in range(1, count + 1)
        ],
    }


def consult():
    return "ask_expert", {
        "thesis": "The synthetic trade depends on the horizon.",
        "question": "Which horizon should we test?",
        "options": ["One quarter", "Three years"],
    }


def finish():
    return "finish", {
        "findings": "The collected observations bound the trade thesis.",
        "limitations": ["Synthetic data."],
    }


class SwarmProvider(FakeProvider):
    def __init__(self, next_action, *, overlap=0):
        super().__init__()
        self.next_action = next_action
        self.expected_overlap = overlap
        self.overlapped = Event()
        self.lock = Lock()
        self.active = set()
        self.peak = self.harnesses = 0

    def run_analyst(self, *args, **kwargs):
        with self.lock:
            self.harnesses += 1
        return super().run_analyst(*args, **kwargs)

    async def complete(self, manifest, prepared, on_delta):
        with self.lock:
            self.calls.append(prepared)
        packet = packets(prepared.input_items)
        model = prepared.model
        if "swarm_roster" in packet:
            assert model == "analysis-model"
            return result(
                model,
                answer={
                    "leads": [
                        {"title": f"Lead {i}", "objective": f"Investigate independent measure {i}."}
                        for i in range(1, packet["swarm_roster"]["lead_count"] + 1)
                    ]
                },
            )
        if "swarm_lead" in packet:
            assert (
                model == "analysis-model" and prepared.analyst_options["tool_choice"] == "required"
            )
            name, arguments = self.next_action(packet["swarm_lead"])
            return result(model, tool=name, arguments=arguments)
        assert model == "test-model"
        self.started.set()
        delegation = packet["swarm_delegation"]
        key = (delegation["lead_index"], delegation["worker_index"])
        with self.lock:
            self.active.add(key)
            self.peak = max(self.peak, len(self.active))
            if self.peak >= self.expected_overlap:
                self.overlapped.set()
        try:
            while self.expected_overlap and not self.released.is_set():
                await asyncio.sleep(0.03)
        finally:
            with self.lock:
                self.active.remove(key)
        answer = result_document("custom")
        answer.update(
            hypotheses=[], review_question=None, conclusion=f"Observed synthetic finding for {key}."
        )
        return result(model, answer=answer)


def setup(
    database,
    provider,
    *,
    leads=1,
    workers=3,
    parallel=3,
    turns=4,
    consults=True,
    output_limit=100000,
    sec=False,
):
    config = {
        "lead_count": leads,
        "researchers_per_lead": workers,
        "max_parallel": parallel,
        "max_lead_turns": turns,
        "allow_consultations": consults,
    }
    document = chain(
        analyst(
            "team",
            sec_financials=sec,
            team={
                "max_agents": 1,
                "lead": {"model": "analysis-model"},
                "researcher": {"model": "test-model"},
                "swarm": config,
            },
        ),
        node("finish", "finish"),
    )
    document.update(
        schema_version="0.3",
        budgets={"max_concurrency": parallel},
        research={
            "model": "test-model",
            "limits": {
                "max_model_calls": 100,
                "max_tool_calls": 100,
                "max_output_characters": output_limit,
                "max_total_tokens": "as_needed",
            },
        },
    )
    revision = RevisionStore(database).save(Workflow.model_validate(document))
    return RunStore(database, provider), RunRequest(
        id=uuid4(),
        revision_id=revision.id,
        provider_account_id="oaiapp_fixture",
        brief="Test the synthetic trade thesis.",
    )


@pytest.mark.parametrize(("leads", "workers", "parallel"), [(1, 20, 20), (3, 4, 2)])
def test_true_worker_overlap_and_one_shared_limit(database, leads, workers, parallel):
    def act(state):
        return delegate(workers, state["lead_index"]) if state["turn"] == 1 else finish()

    provider = SwarmProvider(act, overlap=parallel)
    store, request = setup(
        database, provider, leads=leads, workers=workers, parallel=parallel, turns=2
    )
    with ThreadPoolExecutor(max_workers=1) as parent:
        future = parent.submit(store.start, request)
        try:
            assert provider.overlapped.wait(40)
            current = store.get(request.id)
            running = [a for a in current.model_attempts if a.status == "requesting"]
            assert len({a.path for a in running}) == parallel and provider.peak == parallel
            if leads > 1:
                assert {a.path.split("/")[2] for a in running} == {"lead-1", "lead-2"}
        finally:
            provider.released.set()
        final = future.result(timeout=50)
    assert final.status == "completed", final.stop_reason
    assert provider.harnesses == leads * workers
    assert final.usage.model_calls == len(provider.calls) == 1 + leads * (workers + 2)
    for call in provider.calls:
        state = packets(call.input_items).get("swarm_lead")
        if state and state["turn"] == 2:
            assert len(state["history"][0]["workers"]) == workers
            assert all(
                w["findings"].startswith("Observed synthetic")
                for w in state["history"][0]["workers"]
            )
            assert [t["name"] for t in call.analyst_options["tools"][0]["tools"]] == ["finish"]


def answer(store, paused, review, text):
    return store.resume(
        paused.id,
        ResumeRequest(
            checkpoint_id=paused.checkpoint_id,
            interrupt_id=review.interrupt_id,
            decision="approve",
            feedback=text,
        ),
    )


def test_answered_lead_acts_before_peer_and_completed_workspaces_do_not_restart(database):
    def act(state):
        i, k = state["lead_index"], state["turn"]
        if i == 1 and k == 1 or i == 2 and k == 2:
            return consult()
        if i == 2 and k == 1:
            return delegate(1, i)
        last = state["history"][-1]
        if last.get("owner_answer"):
            return delegate(1, i, last["owner_answer"])
        assert last["workers"]
        return finish()

    provider = SwarmProvider(act)
    store, request = setup(database, provider, leads=2)
    paused = store.start(request)
    assert paused.status == "paused", paused.stop_reason
    first, second = paused.reviews
    assert first.path.endswith("lead-1/turn-1") and second.path.endswith("lead-2/turn-2")
    assert second.perspective.worker_paths == ["root/team/lead-2/agent-1"]
    assert provider.harnesses == 1
    first_ids = {a.path: a.id for a in paused.model_attempts}
    reply = "Test the three-year credit case."
    still_waiting = answer(store, paused, second, reply)
    assert still_waiting.status == "paused", still_waiting.stop_reason
    assert [r.interrupt_id for r in still_waiting.reviews] == [first.interrupt_id]
    assert any(
        a.path == "root/team/lead-2/turn-4" and a.result.swarm_action.action == "finish"
        for a in still_waiting.model_attempts
    )
    assert not any(a.path == "root/team/lead-1/turn-2" for a in still_waiting.model_attempts)
    assert provider.harnesses == 2
    with database.connection() as conn:
        revised = next(
            a for a in still_waiting.model_attempts if a.path == "root/team/lead-2/agent-2"
        )
        request_body = json.loads(read_content(conn, revised.input_artifact_id))
        data = packets(request_body["input"])
        assert reply in data["research_assignment"]["objective"]
        assert data["swarm_delegation"]["owner_answers"][0]["answer"] == reply
        assert data["swarm_delegation"]["preceding_findings"][0]["attempt_path"].endswith(
            "lead-2/agent-1"
        )
    done = answer(store, still_waiting, first, "Use the next quarter as the cutoff.")
    assert done.status == "completed", done.stop_reason
    assert provider.harnesses == 3
    assert len(provider.calls) == len(done.model_attempts)
    assert all(a.id == first_ids[a.path] for a in done.model_attempts if a.path in first_ids)


@pytest.mark.parametrize(
    "bad, why",
    [
        ("capacity", "remaining researcher"),
        ("disabled", "unavailable"),
        ("last", "last permitted turn"),
    ],
)
def test_invalid_tools_stop_before_new_delegation_or_owner_prompt(database, bad, why):
    def act(state):
        if bad == "capacity":
            return delegate(2)
        if bad == "disabled" or state["turn"] == 2:
            return consult()
        return delegate(1)

    provider = SwarmProvider(act)
    store, start = setup(database, provider, workers=1, turns=2, consults=bad != "disabled")
    run = store.start(start)
    assert run.status == "failed" and why in run.stop_reason
    assert not run.reviews and provider.harnesses == int(bad == "last")
    assert run.model_attempts[-1].response_artifact_id


def test_lead_receives_the_workers_grounded_contradiction_and_filing_provenance(
    database, monkeypatch
):
    evidence = EvidenceStore(database).create(
        EvidenceCreate(
            id=uuid4(),
            title="Orders bulletin",
            kind="text",
            publisher="Synthetic source",
            rights="owned",
            text="New orders fell.",
        )
    )
    accession = "0000000001-26-000001"

    async def filing(lookup):
        return SecFinancials.model_validate(
            {
                "request": lookup,
                "status": "available",
                "retrieved_at": "2026-11-20T00:00:00Z",
                "cik": "0000000001",
                "source_url": "https://data.sec.gov/synthetic",
                "observations": [
                    {
                        "start": "2025-01-01",
                        "end": "2025-12-31",
                        "filed": "2026-02-01",
                        "accession": accession,
                        "form": "10-K",
                        "value": 27,
                        "unit": "USD",
                    }
                ],
            }
        )

    class Grounded(SwarmProvider):
        async def complete(self, manifest, prepared, on_delta):
            if "swarm_delegation" not in packets(prepared.input_items):
                return await super().complete(manifest, prepared, on_delta)
            answer = result_document("custom")
            answer.update(review_question=None, sec_lookup={"ticker": "TEST", "metric": "revenue"})
            answer["hypotheses"][0].update(
                assessment="contradicted",
                citations=[
                    {
                        "evidence_id": str(evidence.id),
                        "relation": "contradicts",
                        "basis": "source_text",
                        "locator": "Orders paragraph",
                        "quote": "New orders fell.",
                        "rationale": "The reported decline contradicts the expected rise.",
                    }
                ],
            )
            return result(prepared.model, answer=answer)

    monkeypatch.setattr("researchchain.research.lookup_sec_financials", filing)
    provider = Grounded(lambda state: delegate(1) if state["turn"] == 1 else finish())
    store, request = setup(database, provider, workers=1, turns=2, sec=True)
    run = store.start(request.model_copy(update={"evidence_ids": [evidence.id]}))
    assert run.status == "completed", run.stop_reason
    with database.connection() as conn:
        body = json.loads(read_content(conn, run.model_attempts[-1].input_artifact_id))
    worker = packets(body["input"])["swarm_lead"]["history"][0]["workers"][0]
    from_tool = next(
        json.loads(item["output"])["workers"][0]
        for item in body["input"]
        if item.get("type") == "function_call_output"
    )
    assert worker == from_tool
    hypothesis = worker["evidence_hypotheses"][0]
    assert hypothesis["id"] == "H1" and hypothesis["assessment"] == "contradicted"
    cited = hypothesis["citations"][0]
    assert (cited["evidence_id"], cited["relation"], cited["basis"], cited["locator"]) == (
        str(evidence.id),
        "contradicts",
        "source_text",
        "Orders paragraph",
    )
    observation = worker["sec_financials"]["observations"][0]
    assert (observation["accession"], observation["unit"], observation["value"]) == (
        accession,
        "USD",
        27,
    )


@pytest.mark.parametrize(
    "scenario", ["delegate", "open_question", "oversized", "namespace", "multiple"]
)
def test_native_tool_only_http_stream_is_journaled_and_returned_to_its_lead(
    database, monkeypatch, scenario
):
    fixture = FakeProvider()
    provider = ChatGPTResearchProvider()
    monkeypatch.setattr(provider, "status", fixture.status)
    monkeypatch.setattr(provider, "run_analyst", fixture.run_analyst)
    monkeypatch.setattr(ChatGPTAuth, "access", lambda self: (fixture.account.id, "synthetic"))
    client_type = httpx.AsyncClient
    originals = []
    feedback = "I would revisit the thesis if the time series reversed."

    def handle(request):
        originals.append(request.content)
        body = json.loads(request.content)
        data = packets(body["input"])
        model = body["model"]
        if "swarm_roster" in data:
            reply = result(
                model,
                answer={"leads": [{"title": "Orders", "objective": "Test the order hypothesis."}]},
            )
        elif "swarm_lead" in data:
            second = data["swarm_lead"]["turn"] == 2
            if second:
                call = next(item for item in body["input"] if item.get("type") == "function_call")
                received = next(
                    item for item in body["input"] if item.get("type") == "function_call_output"
                )
                assert received["call_id"] == call["call_id"] == "actual-native-action"
                tool_receipt = json.loads(received["output"])
                if scenario == "open_question":
                    assert tool_receipt["owner_answer"] == feedback
                else:
                    worker = tool_receipt["workers"][0]
                    assert (
                        worker["findings"] == "Synthetic observed orders fell."
                        and worker["attempt_id"]
                    )
                assert [i["name"] for i in body["tools"][0]["tools"]] == ["finish"]
                name, args = finish()
            else:
                name, args = delegate(1)
                if scenario == "oversized":
                    args["rationale"] = "x" * 1500
                if scenario == "open_question":
                    name, args = consult()
                    args.update(question="What would change your mind?", options=[])
            reply = result(model, tool=name, arguments=args)
            item = reply.analyst_response["output"][0]
            item["call_id"] = "native-finish" if second else "actual-native-action"
            if scenario == "namespace":
                item["namespace"] = "other"
            if scenario == "multiple":
                reply.analyst_response["output"].append(
                    {**item, "id": "other-native-call", "call_id": "second-call"}
                )
        else:
            answer = result_document("custom")
            answer.update(
                hypotheses=[], review_question=None, conclusion="Synthetic observed orders fell."
            )
            reply = result(model, answer=answer)
        # Tool turns have no text deltas and an empty final output list. The
        # transport must retain the authoritative output_item.done events.
        events = [
            {"type": "response.output_item.done", "item": item}
            for item in reply.analyst_response["output"]
        ]
        if "swarm_roster" in data:
            events.append({"type": "response.output_text.delta", "delta": reply.text})
        events.append(
            {"type": "response.completed", "response": {**reply.analyst_response, "output": []}}
        )
        return httpx.Response(
            200,
            headers={"Content-Type": "text/event-stream"},
            content="".join("data: " + json.dumps(evt) + "\n\n" for evt in events),
        )

    def synthetic_client(*args, **kwargs):
        return client_type(*args, **{**kwargs, "transport": httpx.MockTransport(handle)})

    monkeypatch.setattr(httpx, "AsyncClient", synthetic_client)
    store, start = setup(database, provider, workers=1, turns=2, output_limit=1000)
    run = store.start(start)
    if scenario == "open_question":
        assert run.status == "paused", run.stop_reason
        assert (
            run.review.question == "What would change your mind?"
            and run.review.perspective.options == []
        )
        run = answer(store, run, run.review, feedback)
    if scenario in {"oversized", "namespace", "multiple"}:
        assert run.status == "failed", run.stop_reason
        assert len(originals) == 2 and run.model_attempts[-1].response_artifact_id
        assert {
            "oversized": "output limit",
            "namespace": "unrecognized",
            "multiple": "exactly one",
        }[scenario] in run.stop_reason
    else:
        assert run.status == "completed", run.stop_reason
        assert len(originals) == (3 if scenario == "open_question" else 4)
    with database.connection() as conn:
        for attempt, payload in zip(run.model_attempts, originals, strict=True):
            assert read_content(conn, attempt.input_artifact_id) == payload
            if "/turn-" in attempt.path:
                recorded = json.loads(read_content(conn, attempt.response_artifact_id))
                assert (
                    recorded["model_text"] == ""
                    and recorded["analyst_response"]["output"][0]["type"] == "function_call"
                )
                assert attempt.output_characters == sum(
                    len(item["arguments"]) for item in recorded["analyst_response"]["output"]
                )
