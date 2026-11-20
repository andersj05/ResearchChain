"""Exercise adaptive team admission, workspace isolation and replay with synthetic inference."""

import asyncio
import json
import os
import shutil
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from threading import Event, Lock
from uuid import uuid4

import pytest
from graph_fixtures import chain, node, split
from pydantic import ValidationError
from test_research_runtime import FakeProvider

from researchchain.analyst_workspace import PythonRun
from researchchain.artifacts import read_content
from researchchain.codex_analyst import run_codex_analyst
from researchchain.dispatch import RunQueue
from researchchain.graph import Workflow
from researchchain.models import RunRequest
from researchchain.research import ResearchExecutor
from researchchain.revisions import RevisionStore
from researchchain.runtime import RunStore
from researchchain.worker import RunWorker


def workspace_script(title):
    if title != "Editor":
        value = 2 if title == "Demand" else 7
        return (
            "from pathlib import Path\n"
            f"Path('outputs/series.csv').write_text('measure,value\\n{title},{value}\\n')\n"
        )
    return (
        "import csv\nfrom pathlib import Path\nimport matplotlib.pyplot as plt\n"
        "values = {}\n"
        "for file in sorted(Path('.').glob('agent-*-series.csv')):\n"
        "    with file.open() as stream:\n"
        "        for row in csv.DictReader(stream):\n"
        "            values[row['measure']] = int(row['value'])\n"
        "assert values == {'Demand': 2, 'Inventories': 7}\n"
        "plt.bar(list(values), list(values.values()))\nplt.ylabel('Synthetic units')\n"
        "plt.savefig('outputs/comparison.png')\n"
        "lines = [f'{key}: {value}' for key, value in values.items()]\n"
        "lines.append('![Comparison of synthetic measures](comparison.png)')\n"
        "report = '# Synthetic measures\\n\\n' + '\\n\\n'.join(lines)\n"
        "Path('outputs/report.md').write_text(report)\n"
    )


class TeamProvider(FakeProvider):
    def __init__(self, agent_count=2, *, workspaces=False, hold=False):
        super().__init__()
        self.titles = ["Demand", "Inventories", "Financing", "Pricing"][:agent_count]
        self.workspaces = workspaces
        self.hold = hold
        self.active = self.peak = 0
        self.lock = Lock()
        self.overlap = Event()

    async def complete(self, manifest, prepared, on_delta):
        response = await super().complete(manifest, prepared, on_delta)
        if "assignments" in prepared.schema["properties"]:
            assert prepared.analyst_options is None and not prepared.web_search
            assert "Style sample for editor" not in str(prepared.input_items)
            return replace(
                response,
                text=json.dumps(
                    {
                        "assignments": [
                            {"title": title, "objective": f"Test {title} for the supplied brief."}
                            for title in self.titles
                        ],
                        "review_question": None,
                    }
                ),
            )
        member = "review_question" in prepared.schema["properties"]
        if member:
            item = prepared.input_items[1]["content"][0]["text"]
            title = json.loads(item)["research_assignment"]["title"]
            assert "Style sample for editor" not in str(prepared.input_items)
            with self.lock:
                self.active += 1
                self.peak = max(self.peak, self.active)
                if self.active == 2:
                    self.overlap.set()
            try:
                while self.hold and not self.released.is_set():
                    await asyncio.sleep(0.02)
            finally:
                with self.lock:
                    self.active -= 1
        else:
            title = "Editor"
        receipts = [
            item for item in prepared.input_items if item.get("type") == "function_call_output"
        ]
        if self.workspaces and not receipts:
            tool = {
                "type": "function_call",
                "namespace": "research",
                "name": "run_python",
                "id": f"write-{title}",
                "call_id": f"write-{title}",
                "arguments": json.dumps({"purpose": title, "script": workspace_script(title)}),
            }
            return replace(
                response, analyst_response={**response.analyst_response, "output": [tool]}
            )
        answer = json.loads(response.text)
        answer["conclusion"] = f"Saved findings for {title}."
        if member:
            answer["review_question"] = (
                "Which demand measure fits your mandate?" if title == "Demand" else None
            )
        text = json.dumps(answer)
        final = {
            "type": "message",
            "id": f"final-{title}",
            "role": "assistant",
            "status": "completed",
            "content": [{"type": "output_text", "text": text, "annotations": []}],
        }
        return replace(
            response, text=text, analyst_response={**response.analyst_response, "output": [final]}
        )


def analyst(node_id, **config):
    return node(
        node_id,
        "research",
        config={
            "type": "research",
            "stage": "custom",
            "prompt_version": "custom-1",
            "analyst": {"workspace": True, "max_passes": 3},
            **config,
        },
    )


def setup_team(database, provider, *, parallel_teams=False, editor=False, concurrency=2, **limits):
    team = analyst("team", team={"max_agents": 3})
    if parallel_teams:
        document = split()
        for index, name in enumerate(("left", "right"), 1):
            document["nodes"][index] = analyst(name, team={"max_agents": 3})
    else:
        nodes = [team]
        if editor:
            writer = analyst("editor", style_excerpt="Style sample for editor")
            writer["inputs"] = {"context": {"source": "output", "node_id": "team", "port": "text"}}
            nodes.append(writer)
        document = chain(*nodes, node("finish", "finish"))
    document.update(
        schema_version="0.3",
        budgets={"max_concurrency": concurrency},
        research={
            "model": "test-model",
            "limits": {
                "max_model_calls": 25,
                "max_tool_calls": 25,
                "max_total_tokens": "as_needed",
                **limits,
            },
        },
    )
    revision = RevisionStore(database).save(Workflow.model_validate(document))
    return RunStore(database, provider), RunRequest(
        id=uuid4(),
        revision_id=revision.id,
        brief="Investigate the synthetic capital cycle.",
        provider_account_id=provider.account.id,
    )


def test_active_workspaces_overlap_and_join_real_receipts(database, monkeypatch):
    provider = TeamProvider(workspaces=True, hold=True)
    store, request = setup_team(database, provider, editor=True)
    members = {}

    def python_action(action, inputs, guard):
        guard()
        if action.purpose == "Editor":
            datasets = {name: content for name, content in inputs.items() if name.endswith(".csv")}
            assert sorted(datasets.values()) == [b"Demand", b"Inventories"]
            assert len(datasets) == 2
            return PythonRun(0, "Joined both results", {"report.md": b"Demand and inventories."})
        assert inputs == {}
        members[action.purpose] = action.script
        return PythonRun(0, "Saved dataset", {"series.csv": action.purpose.encode()})

    monkeypatch.setattr("researchchain.research.run_python", python_action)
    with ThreadPoolExecutor(max_workers=1) as executor:
        run = executor.submit(store.start, request)
        try:
            assert provider.overlap.wait(15)
            live = store.get(request.id)
            assert live.status == "running"
            plan, *members_in_progress = live.model_attempts
            assert plan.path == "root/team/plan" and plan.status == "completed"
            assert [a.title for a in plan.result.team_plan.assignments] == provider.titles
            assert {a.path for a in members_in_progress} == {
                "root/team/agent-1",
                "root/team/agent-2",
            }
            assert all(
                a.status == "requesting" and a.output_characters > 0 for a in members_in_progress
            )
        finally:
            provider.released.set()
        result = run.result(timeout=20)
    assert result.status == "completed", result.stop_reason
    assert result.research_manifest.tool_config["team_version"] == "research-team-1"
    assert set(members) == set(provider.titles) and provider.peak == 2
    assert result.usage.model_calls == 7
    assert all(a.admission_policy_revision for a in result.model_attempts)
    with database.connection() as conn:
        editor_request = next(a for a in result.model_attempts if a.path == "root/editor")
        raw = json.loads(read_content(conn, editor_request.input_artifact_id))
        packet = json.loads(raw["input"][0]["content"][0]["text"])
        assert packet["writing_style_reference"] == "Style sample for editor"
        handoff = json.loads(packet["additional_context"])
        assert handoff["review_question"] == "Which demand measure fits your mandate?"
        assert [a["title"] for a in handoff["agents"]] == provider.titles
        assert [a["attempt_path"] for a in handoff["agents"]] == [
            f"root/team/agent-{n}/analyst-pass-2" for n in (1, 2)
        ]
        assert result.model_attempts[-1].result.workspace_files[0].name == "report.md"


def test_simultaneous_teams_share_the_concurrency_limit(database):
    provider = TeamProvider(agent_count=3, hold=True)
    store, request = setup_team(database, provider, parallel_teams=True)
    with ThreadPoolExecutor(max_workers=1) as executor:
        run = executor.submit(store.start, request)
        try:
            assert provider.overlap.wait(15)
            live = store.get(request.id)
            assert sum(a.status == "requesting" for a in live.model_attempts) == 2
        finally:
            provider.released.set()
        final = run.result(timeout=20)
    assert final.status == "completed", final.stop_reason
    assert provider.peak == 2
    assert final.usage.model_calls == 8


@pytest.mark.skipif(
    os.environ.get("RESEARCHCHAIN_TEST_PYTHON_IMAGE") != "1" or not shutil.which("codex"),
    reason="Requires the local Codex CLI and built research Python image",
)
def test_codex_team_and_python_image_produce_chart_and_report(database):
    class LocalCodexTeam(TeamProvider):
        run_analyst = staticmethod(run_codex_analyst)

    provider = LocalCodexTeam(workspaces=True, hold=True)
    store, request = setup_team(database, provider, editor=True)
    with ThreadPoolExecutor(max_workers=1) as executor:
        run = executor.submit(store.start, request)
        try:
            assert provider.overlap.wait(30)
        finally:
            provider.released.set()
        final = run.result(timeout=120)
    assert final.status == "completed", final.stop_reason
    assert provider.peak == 2
    assert len(provider.calls) == 7
    outputs = {file.name: file for file in final.model_attempts[-1].result.workspace_files}
    assert set(outputs) == {"analysis.py", "comparison.png", "report.md"}
    with database.connection() as conn:
        chart = read_content(conn, outputs["comparison.png"].artifact_id)
        report = read_content(conn, outputs["report.md"].artifact_id).decode()
        assert chart.startswith(b"\x89PNG") and "](comparison.png)" in report
        assert "Demand: 2" in report and "Inventories: 7" in report


def test_cancelling_running_team_closes_members_without_admitting_waiting_one(database):
    provider = TeamProvider(agent_count=3, hold=True)
    store, request = setup_team(database, provider)
    with ThreadPoolExecutor(max_workers=1) as executor:
        run = executor.submit(store.start, request)
        try:
            assert provider.overlap.wait(15)
            assert store.cancel(request.id).status == "cancelled"
            final = run.result(timeout=15)
        finally:
            provider.released.set()
    assert final.status == "cancelled" and provider.active == 0
    assert [a.status for a in final.model_attempts] == ["completed", "cancelled", "cancelled"]
    assert len(provider.calls) == 3


@pytest.mark.parametrize(
    "limits,reason",
    [
        ({"max_total_tokens": 60}, "token budget"),
        ({"max_model_calls": 2}, "Model-call budget"),
        ({"max_tool_calls": 2}, "Evidence-tool call budget"),
    ],
)
def test_shared_limits_bound_the_entire_team(database, limits, reason):
    provider = TeamProvider(agent_count=3)
    store, request = setup_team(database, provider, **limits)
    final = store.start(request)
    assert final.status == "limited" and reason in final.stop_reason
    assert len(provider.calls) <= 2 and len(final.model_attempts) <= 2
    if "max_total_tokens" in limits:
        assert [a.path for a in final.model_attempts] == ["root/team/plan", "root/team/agent-1"]
        assert final.usage.input_tokens + final.usage.output_tokens == 80


def test_invalid_director_plan_cannot_launch_an_agent(database):
    provider = TeamProvider(agent_count=4)
    store, request = setup_team(database, provider)
    final = store.start(request)
    assert final.status == "failed" and "team limit of 3" in final.stop_reason
    assert [a.path for a in final.model_attempts] == ["root/team/plan"]
    assert final.model_attempts[0].response_artifact_id


def test_recovery_reuses_confirmed_plan_and_member(database, monkeypatch):
    provider = TeamProvider()
    store, request = setup_team(database, provider, concurrency=1)
    finish = ResearchExecutor.finish

    def after_member(self, *args, **kwargs):
        finish(self, *args, **kwargs)
        if kwargs.get("result") and kwargs["result"].review_question:
            raise RuntimeError("Lost worker after the confirmed member response")

    with monkeypatch.context() as patch:
        patch.setattr(ResearchExecutor, "finish", after_member)
        with pytest.raises(RuntimeError, match="after the confirmed"):
            store.start(request)
    original = store.get(request.id)
    assert len(original.model_attempts) == 2 and len(provider.calls) == 2
    final = store.recover(request.id)
    assert final.status == "completed", final.stop_reason
    assert len(provider.calls) == 3
    assert [a.id for a in original.model_attempts] == [a.id for a in final.model_attempts[:2]]


@pytest.mark.parametrize("queued_recovery", [True, False])
def test_takeover_fences_every_uncertain_member_before_new_admissions(database, queued_recovery):
    class InterruptedProvider(TeamProvider):
        async def complete(self, manifest, prepared, on_delta):
            response = await super().complete(manifest, prepared, on_delta)
            if prepared.analyst_options:
                raise RuntimeError("Worker lost after send")
            return response

    provider = InterruptedProvider(agent_count=3, hold=True)
    store, request = setup_team(database, provider)
    queue = RunQueue(store)
    queue.start(request)
    with ThreadPoolExecutor(max_workers=1) as executor:
        work = executor.submit(RunWorker(store).run_once)
        try:
            assert provider.overlap.wait(15)
        finally:
            provider.released.set()
        assert work.result(timeout=15)
    assert store.get(request.id).status == "interrupted"
    if queued_recovery:
        queue.recover(request.id)
        assert RunWorker(store).run_once()
        final = store.get(request.id)
    else:
        final = store.recover(request.id)
    assert final.status == "failed" and "uncertain" in final.stop_reason
    assert [a.status for a in final.model_attempts] == ["completed", "unknown", "unknown"]
    assert len(provider.calls) == 3


def test_team_requires_workspace_and_bounded_count():
    document = chain(analyst("team", team={"max_agents": 2}), node("done", "finish"))
    document.update(schema_version="0.3", research={"model": "test-model"})
    config = document["nodes"][0]["config"]
    config["analyst"]["workspace"] = False
    with pytest.raises(ValidationError, match="workspace"):
        Workflow.model_validate(document)
    config["analyst"]["workspace"] = True
    config["team"]["max_agents"] = 5
    with pytest.raises(ValidationError, match="less than or equal to 4"):
        Workflow.model_validate(document)
    config.pop("team")
    assert (
        "team" not in Workflow.model_validate(document).canonical_document()["nodes"][0]["config"]
    )
