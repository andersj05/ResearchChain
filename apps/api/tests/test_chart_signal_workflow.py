"""Run the chart workflow with scripted Codex decisions and real workspace files."""

import csv
import io
import json
import os
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import pytest
from test_research_runtime import approve
from test_signal_holdout import COLUMNS, observations
from test_web_research import WebProvider

from researchchain.artifacts import read_content
from researchchain.graph import Workflow
from researchchain.models import RunRequest
from researchchain.revisions import RevisionStore
from researchchain.runtime import RunStore

EXAMPLE = Path(__file__).resolve().parents[3] / "examples/chart-signal.json"


class SignalProvider(WebProvider):
    async def complete(self, manifest, prepared, on_delta):
        completion = await super().complete(manifest, prepared, on_delta)
        tools = (prepared.analyst_options or {}).get("tools", [])
        if not any(t["name"] == "run_python" for group in tools for t in group.get("tools", [])):
            return completion
        if any(i.get("type") == "function_call_output" for i in prepared.input_items):
            return completion
        if prepared.web_search:
            script = (
                "from pathlib import Path\n"
                "panel = next(Path('.').glob('evidence-*.csv'))\n"
                "Path('outputs/observations.csv').write_bytes(panel.read_bytes())\n"
            )
        else:
            packet = json.loads(prepared.input_items[0]["content"][0]["text"])
            cutoff = packet["human_feedback"]
            script = (
                "import subprocess, sys\n"
                "subprocess.run([sys.executable, '/opt/researchchain/signal_holdout.py', "
                f"'observations.csv', {cutoff!r}], check=True)"
            )
        call = {
            "type": "function_call",
            "namespace": "research",
            "name": "run_python",
            "call_id": f"fixture-{len(self.calls)}",
            "arguments": json.dumps({"purpose": "Score the synthetic panel.", "script": script}),
        }
        return replace(
            completion, analyst_response={**completion.analyst_response, "output": [call]}
        )


@pytest.mark.skipif(
    os.environ.get("RESEARCHCHAIN_TEST_PYTHON_IMAGE") != "1", reason="Needs analyst image"
)
def test_verified_panel_reaches_forecast_workspace_and_challenge(database, client):
    panel = io.StringIO()
    writer = csv.writer(panel)
    writer.writerow(COLUMNS)
    writer.writerows(observations())
    artifact = client.post(
        "/api/artifacts?name=fixture.csv&rights=owned", content=panel.getvalue().encode()
    )
    assert artifact.status_code == 201, artifact.text
    source_id = uuid4()
    source = client.post(
        "/api/evidence",
        json={
            "id": str(source_id),
            "title": "Synthetic panel",
            "kind": "dataset",
            "rights": "owned",
            "artifact_id": artifact.json()["id"],
        },
    )
    assert source.status_code == 201, source.text
    workflow = Workflow.model_validate_json(EXAMPLE.read_bytes())
    workflow.research.model = "test-model"
    provider = SignalProvider()
    store = RunStore(database, provider)
    run = store.start(
        RunRequest(
            id=uuid4(),
            revision_id=RevisionStore(database).save(workflow).id,
            brief="Evaluate the supplied synthetic signal.",
            evidence_ids=[source_id],
            provider_account_id=provider.account.id,
        )
    )
    assert run.review.node_id == "design"
    reviewed = store.resume(run.id, approve(run, "2020-01-09T00:00:00Z"))
    assert reviewed.status == "paused", reviewed.stop_reason
    assert reviewed.review.node_id == "verdict"
    challenge = next(a for a in reviewed.model_attempts if a.path == "root/challenge")
    with database.connection() as conn:
        request = json.loads(read_content(conn, challenge.input_artifact_id))
        prior = json.loads(request["input"][0]["content"][0]["text"])["prior_result"]
        files = {f["name"]: f["artifact_id"] for f in prior["workspace_files"]}
        assert read_content(conn, files["observations.csv"]) == panel.getvalue().encode()
        metrics = json.loads(read_content(conn, files["holdout-metrics.json"]))
        assert metrics["holdout_rows"] == 4 and metrics["model_rmse"] == 0
        assert metrics["out_of_sample_r2"] == 1
        assert {"holdout-method.py", "holdout-predictions.csv"} <= files.keys()
