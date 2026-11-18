"""Exercise the workspace boundary and a synthetic turn through the installed Codex CLI."""

import base64
import json
import os
import shutil

import pytest

from researchchain.analyst_workspace import PythonRequest, _receipt, _request, run_python
from researchchain.codex_analyst import run_codex_analyst, tool_call
from researchchain.research_models import StoredResearchResult

ACTION = PythonRequest(
    purpose="Chart the three supplied synthetic observations.",
    script="""import csv
import os
from pathlib import Path
import matplotlib.pyplot as plt
with open("observations.csv") as f:
    values = [float(row["value"]) for row in csv.DictReader(f)]
assert Path("analysis.py").read_text() == "# earlier calculation"
assert not os.access(".", os.W_OK)
assert os.getuid() == 65534
assert not os.environ.get("RESEARCHCHAIN_SESSION")
assert int(next(line.split()[1] for line in Path("/proc/self/status").read_text().splitlines()
                if line.startswith("CapEff:")), 16) == 0
plt.plot(values)
plt.savefig("outputs/observations.png")
Path("outputs/memo.md").write_text("This chart uses three synthetic observations.")
print("Observed total:", sum(values))
""",
)


def test_capability_requires_workspace_and_one_action():
    call = {
        "type": "function_call",
        "namespace": "research",
        "name": "run_python",
        "call_id": "synthetic-python",
        "arguments": ACTION.model_dump_json(),
    }
    with pytest.raises(ValueError, match="outside this analyst"):
        tool_call({"output": [call]})
    assert tool_call({"output": [call]}, workspace=True) == call
    with pytest.raises(ValueError, match="one research tool"):
        tool_call({"output": [call, call]}, workspace=True)


@pytest.mark.parametrize("name", ["../note.txt", "a/b.csv", "C:\\data.csv", "outputs"])
def test_workspace_rejects_invalid_staged_names(name):
    with pytest.raises(ValueError, match="invalid input filename"):
        _request(ACTION, {name: b"unused"})


@pytest.mark.parametrize(
    "filename,content",
    [("../report.md", b"text"), ("report.html", b"text"), ("chart.png", b"not a chart")],
)
def test_workspace_checks_container_export_boundary(filename, content):
    raw = json.dumps(
        {"exit_code": 0, "output": "", "files": {filename: base64.b64encode(content).decode()}}
    )
    with pytest.raises(ValueError, match="invalid"):
        _receipt(raw.encode(), ACTION.script)


def result(next_lead=None):
    return StoredResearchResult(
        schema_version="research-result-1",
        stage="custom",
        hypotheses=[],
        unresolved_questions=[],
        evidence_requests=[],
        conclusion="Synthetic step.",
        revision_summary="Processed synthetic observations.",
        limitations=["Synthetic input."],
        next_lead=next_lead,
    )


@pytest.mark.skipif(
    os.environ.get("RESEARCHCHAIN_TEST_PYTHON_IMAGE") != "1",
    reason="Requires the built research Python Docker image",
)
@pytest.mark.skipif(not shutil.which("codex"), reason="Requires the local Codex CLI")
def test_installed_codex_python_chart_and_receipt_without_inference():
    receipts = []

    def step(history, body):
        if not history:
            run = run_python(
                ACTION,
                {"observations.csv": b"value\n2\n3\n5\n", "analysis.py": b"# earlier calculation"},
                lambda: None,
            )
            assert run.exit_code == 0, run.output
            assert "Observed total: 10.0" in run.output
            assert run.files["analysis.py"].decode() == ACTION.script
            assert run.files["observations.png"].startswith(b"\x89PNG\r\n\x1a\n")
            assert run.files["memo.md"].startswith(b"This chart")
            # Use the real result as the dynamic tool receipt seen by Codex.
            intermediate = result(ACTION.purpose)
            intermediate.conclusion = run.output
            item = {
                "type": "function_call",
                "namespace": "research",
                "name": "run_python",
                "id": "synthetic-tool",
                "call_id": "synthetic-tool",
                "status": "completed",
                "arguments": ACTION.model_dump_json(),
            }
        else:
            receipts.extend(x for x in body["input"] if x.get("type") == "function_call_output")
            intermediate = result()
            item = {
                "type": "message",
                "id": "synthetic-answer",
                "role": "assistant",
                "status": "completed",
                "content": [{"type": "output_text", "text": intermediate.model_dump_json()}],
            }
        return intermediate, {
            "id": f"response-{len(history)}",
            "status": "completed",
            "model": "test-model",
            "output": [item],
        }

    final = run_codex_analyst("test-model", 2, step, lambda: None, workspace=True)
    assert final.next_lead is None
    assert len(receipts) == 1 and "Observed total: 10.0" in str(receipts[0]["output"])


@pytest.mark.skipif(
    os.environ.get("RESEARCHCHAIN_TEST_PYTHON_IMAGE") != "1",
    reason="Requires the built research Python Docker image",
)
def test_python_returns_correctable_receipt_for_invalid_export_and_finishes_helpers():
    action = PythonRequest(
        purpose="Check unsupported export and helper cleanup.",
        script=(
            "from pathlib import Path\n"
            "import subprocess, sys\n"
            "subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(150)'])\n"
            "Path('outputs/bad.png').write_text('not a PNG')\n"
            "Path('outputs/notes.md').write_text('valid output')\n"
        ),
    )
    run = run_python(action, {}, lambda: None)
    assert run.exit_code == 1 and "Skipped bad.png" in run.output
    assert run.files == {"notes.md": b"valid output", "analysis.py": action.script.encode()}
