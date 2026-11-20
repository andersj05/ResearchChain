import base64
import io
import json
from dataclasses import replace
from uuid import uuid4
from zipfile import ZipFile

from access_fixtures import owner_client
from test_research_sessions import SessionProvider, request

from researchchain.analyst_workspace import PythonRun
from researchchain.main import create_app
from researchchain.runtime import RunStore
from researchchain.worker import RunWorker

CHART = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3VkAAAAASUVORK5CYII="
)


class FileProvider(SessionProvider):
    async def complete(self, manifest, prepared, on_delta):
        completion = await super().complete(manifest, prepared, on_delta)
        if not prepared.analyst_options or any(
            item.get("type") == "function_call_output" for item in prepared.input_items
        ):
            return completion
        packet = json.loads(prepared.input_items[0]["content"][0]["text"])
        author = "researcher" if "research_assignment" in str(prepared.input_items) else "editor"
        if packet["brief"] == "No report":
            return completion
        call = {
            "type": "function_call",
            "name": "run_python",
            "namespace": "research",
            "id": "make-files",
            "call_id": "make-files",
            "status": "completed",
            "arguments": json.dumps({"purpose": author, "script": f"# {packet['brief']}"}),
        }
        return replace(
            completion, analyst_response={**completion.analyst_response, "output": [call]}
        )


def test_download_contains_only_the_completed_sessions_final_editor_workspace(
    database, monkeypatch
):
    def execute(action, inputs, guard):
        guard()
        if action.purpose == "researcher":
            files = {"report.md": b"Researcher's own draft", "private.csv": b"private"}
        else:
            assert b"Researcher's own draft" in inputs.values()
            files = {
                "report.md": (action.script + "\n\n![Observed series](figure.png)").encode(),
                "figure.png": CHART,
                "series.csv": b"period,value\n1,4",
            }
        return PythonRun(
            0, "Saved synthetic files", {**files, "analysis.py": action.script.encode()}
        )

    monkeypatch.setattr("researchchain.research.run_python", execute)
    provider = FileProvider()
    runs = RunStore(database, provider)
    worker = RunWorker(runs)
    app = create_app(database, provider)
    sessions = "/api/research-sessions"
    with owner_client(app, workers=False) as client:
        outputs = []
        for brief in ("First study", "Different study", "No report"):
            start = request(brief=brief, review_mode="never")
            assert client.post(sessions, json=start.model_dump(mode="json")).status_code == 202
            url = f"{sessions}/{start.id}/report.zip"
            assert client.get(url).status_code == 409
            assert worker.run_once()
            final = runs.get(start.id)
            assert final.status == "completed", final.stop_reason
            outputs.append((brief, url))
        calls_before_export = len(provider.calls)
        for brief, url in outputs[:2]:
            response = client.get(url)
            assert response.status_code == 200, response.text
            assert response.headers["content-type"] == "application/zip"
            assert "attachment" in response.headers["content-disposition"]
            assert "no-store" in response.headers["cache-control"]
            with ZipFile(io.BytesIO(response.content)) as archive:
                assert set(archive.namelist()) == {
                    "report.md",
                    "analysis.py",
                    "figure.png",
                    "series.csv",
                }
                assert (
                    archive.read("report.md")
                    == f"# {brief}\n\n![Observed series](figure.png)".encode()
                )
                assert archive.read("figure.png") == CHART
                assert archive.read("series.csv") == b"period,value\n1,4"
        assert client.get(outputs[2][1]).status_code == 404
        ordinary_id = str(uuid4())
        assert (
            client.post(
                "/api/runs",
                json={
                    "id": ordinary_id,
                    "brief": "Ordinary workflow",
                    "revision_id": str(final.revision_id),
                    "provider_account_id": provider.account.id,
                },
            ).status_code
            == 202
        )
        assert client.get(f"{sessions}/{ordinary_id}/report.zip").status_code == 404
        client.cookies.clear()
        assert client.get(outputs[0][1]).status_code == 401
        assert len(provider.calls) == calls_before_export
