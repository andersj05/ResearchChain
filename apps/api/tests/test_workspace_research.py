"""A confirmed workspace action survives a worker restart and supplies the next experiment."""

import json
import os
import shutil
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import pytest
from test_research_runtime import FakeProvider, approve

from researchchain.analyst_workspace import PythonRun
from researchchain.artifacts import read_content
from researchchain.codex_analyst import run_codex_analyst
from researchchain.graph import Workflow
from researchchain.models import RunRequest
from researchchain.research import ResearchExecutor
from researchchain.research_workspace import generated_files
from researchchain.revisions import RevisionStore
from researchchain.runtime import RunStore

DEMO = Path(__file__).resolve().parents[3] / "examples" / "idea-generation.json"


class WorkspaceProvider(FakeProvider):
    async def complete(self, manifest, prepared, on_delta):
        completion = await super().complete(manifest, prepared, on_delta)
        if prepared.analyst_options is None:
            return completion
        receipts = [i for i in prepared.input_items if i.get("type") == "function_call_output"]
        if len(receipts) == 2:
            assert "corrected.csv" in receipts[-1]["output"]
            return completion
        tools = prepared.analyst_options["tools"]
        assert any(t.get("name") == "run_python" for tool in tools for t in tool.get("tools", []))
        call_id = f"calculate-{len(receipts)}"
        call = {
            "type": "function_call",
            "namespace": "research",
            "name": "run_python",
            "id": call_id,
            "call_id": call_id,
            "arguments": json.dumps(
                {"purpose": "Test the series", "script": f"print({len(receipts)})"}
            ),
        }
        return replace(
            completion, analyst_response={**completion.analyst_response, "output": [call]}
        )


def test_workspace_files_recover_and_feed_later_tools(database, monkeypatch):
    document = Workflow.model_validate_json(DEMO.read_bytes())
    document.research.model = "test-model"
    revision = RevisionStore(database).save(document)
    provider = WorkspaceProvider()
    store = RunStore(database, provider)
    executions = []

    def execute(request, files, guard):
        guard()
        executions.append(request.script)
        if len(executions) == 1:
            assert files == {}
            return PythonRun(
                1,
                "Found a missing observation",
                {"analysis.py": request.script.encode(), "series.csv": b"period,value\nQ1,17"},
            )
        assert files["series.csv"].endswith(b"Q1,17")
        assert files["analysis.py"] == b"print(0)"
        return PythonRun(
            0,
            "Kept the available quarter",
            {"analysis.py": request.script.encode(), "corrected.csv": files["series.csv"]},
        )

    monkeypatch.setattr("researchchain.research.run_python", execute)
    run = store.start(
        RunRequest(
            id=uuid4(),
            revision_id=revision.id,
            brief="Synthetic quarterly series",
            provider_account_id=provider.account.id,
        )
    )
    assert run.review.node_id == "direction"
    original_finish = ResearchExecutor.finish

    def interrupt(self, *args, **kwargs):
        original_finish(self, *args, **kwargs)
        if kwargs.get("exports"):
            raise RuntimeError("Worker exited after a confirmed Python action")

    with monkeypatch.context() as patch:
        patch.setattr(ResearchExecutor, "finish", interrupt)
        with pytest.raises(RuntimeError, match="confirmed Python action"):
            store.resume(run.id, approve(run))
    recovered = store.recover(run.id)
    assert recovered.review.node_id == "review"
    assert executions == ["print(0)", "print(1)"]
    first, second, final = recovered.model_attempts[1:]
    assert first.result.workspace_activity.status == "failed"
    assert second.result.workspace_activity.status == "completed"
    assert final.result.workspace_activity is None
    files = {f.name: f for f in final.result.workspace_files}
    assert set(files) == {"analysis.py", "series.csv", "corrected.csv"}
    assert files["series.csv"].artifact_id == files["corrected.csv"].artifact_id
    assert len(provider.calls) == 4
    assert all(a.admission_policy_revision for a in recovered.model_attempts)
    with database.connection() as conn:
        assert read_content(conn, files["analysis.py"].artifact_id) == b"print(1)"
        downstream = replace(provider.calls[-1], previous=final.result)
        assert generated_files(conn, run.id, downstream, []) == files
        assert generated_files(conn, uuid4(), downstream, []) == {}
        altered = final.result.model_copy(update={"workspace_files": [files["analysis.py"]]})
        assert generated_files(conn, run.id, replace(downstream, previous=altered), []) == {}


@pytest.mark.skipif(
    os.environ.get("RESEARCHCHAIN_TEST_PYTHON_IMAGE") != "1",
    reason="Requires the built research Python image",
)
def test_demo_stores_real_chart_and_memo_in_the_reviewed_step(database):
    class DemoProvider(FakeProvider):
        if shutil.which("codex"):
            run_analyst = staticmethod(run_codex_analyst)

        async def complete(self, manifest, prepared, on_delta):
            response = await super().complete(manifest, prepared, on_delta)
            if not prepared.analyst_options:
                return response
            if any(i.get("type") == "function_call_output" for i in prepared.input_items):
                assert "rotation.png" in str(prepared.input_items)
                assert any(
                    part.get("type") == "input_image"
                    and part["image_url"].startswith("data:image/png;base64,")
                    for item in prepared.input_items
                    for part in item.get("content", [])
                    if isinstance(part, dict)
                )
                return response
            script = (
                "from pathlib import Path\nimport matplotlib.pyplot as plt\n"
                "plt.plot([1, 2, 3], [2, 5, 4])\nplt.title('Synthetic weekly index')\n"
                "plt.savefig('outputs/rotation.png')\n"
                "Path('outputs/memo.md').write_text('Three synthetic weekly observations.')\n"
                "print('Wrote the synthetic chart and memo.')"
            )
            call = {
                "type": "function_call",
                "namespace": "research",
                "name": "run_python",
                "id": "fixture-python",
                "call_id": "fixture-python",
                "status": "completed",
                "arguments": json.dumps(
                    {"purpose": "Inspect the synthetic chart", "script": script}
                ),
            }
            return replace(
                response, analyst_response={**response.analyst_response, "output": [call]}
            )

    document = Workflow.model_validate_json(DEMO.read_bytes())
    document.research.model = "test-model"
    provider = DemoProvider()
    revision = RevisionStore(database).save(document)
    store = RunStore(database, provider)
    run = store.start(
        RunRequest(
            id=uuid4(),
            revision_id=revision.id,
            brief="Plot the synthetic weekly values 2, 5, 4.",
            provider_account_id=provider.account.id,
        )
    )
    assert run.review.node_id == "direction"
    reviewed = store.resume(run.id, approve(run))
    assert reviewed.status == "paused", reviewed.stop_reason
    assert reviewed.review.node_id == "review"
    files = {f.name: f for f in reviewed.model_attempts[-1].result.workspace_files}
    assert set(files) == {"analysis.py", "rotation.png", "memo.md"}
    with database.connection() as conn:
        assert read_content(conn, files["rotation.png"].artifact_id).startswith(b"\x89PNG")
        assert b"Three synthetic" in read_content(conn, files["memo.md"].artifact_id)
