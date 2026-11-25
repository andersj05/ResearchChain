import base64
import io
import json
from dataclasses import replace
from uuid import uuid4
from zipfile import ZipFile

from access_fixtures import owner_client
from test_evaluation_datasets import evidence
from test_reports import style_request
from test_research_sessions import SessionProvider, request
from test_web_research import WEB_OUTPUT

from researchchain.analyst_workspace import PythonRun
from researchchain.artifacts import read_content
from researchchain.main import create_app
from researchchain.runtime import RunStore
from researchchain.web_research import read_web_research
from researchchain.worker import RunWorker

CHART = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3VkAAAAASUVORK5CYII="
)


class FileProvider(SessionProvider):
    async def complete(self, manifest, prepared, on_delta):
        completion = await super().complete(manifest, prepared, on_delta)
        if not prepared.analyst_options:
            return completion
        packet = json.loads(prepared.input_items[0]["content"][0]["text"])
        author = "researcher" if "research_assignment" in str(prepared.input_items) else "editor"
        if any(item.get("type") == "function_call_output" for item in prepared.input_items):
            if author == "editor" and prepared.web_search:
                return replace(completion, web_research=read_web_research({"output": WEB_OUTPUT}))
            return completion
        if packet["brief"] == "Text report":
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


def test_completed_editor_workspace_download_and_report_import(database, monkeypatch):
    references = "\n\n[Recorded](https://example.org/data) [Unrecorded](https://example.org/unseen)"

    def execute(action, inputs, guard):
        guard()
        if action.purpose == "researcher":
            files = {"report.md": b"Researcher's own draft", "private.csv": b"private"}
        else:
            assert b"Researcher's own draft" in inputs.values()
            files = {
                "report.md": (
                    action.script + "\n\n![Observed series](figure.png)" + references
                ).encode(),
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
        for brief in ("First study", "Different study", "Text report"):
            start = request(brief=brief, review_mode="never", web_search=brief == "First study")
            assert client.post(sessions, json=start.model_dump(mode="json")).status_code == 202
            url = f"{sessions}/{start.id}/report.zip"
            assert client.get(url).status_code == 409
            assert worker.run_once()
            final = runs.get(start.id)
            assert final.status == "completed", final.stop_reason
            outputs.append((brief, url, final))
        calls_before_export = len(provider.calls)
        for brief, url, _ in outputs[:2]:
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
                    == f"# {brief}\n\n![Observed series](figure.png){references}".encode()
                )
                assert archive.read("figure.png") == CHART
                assert archive.read("series.csv") == b"period,value\n1,4"
        editor = final.model_attempts[-1]
        with database.connection() as conn:
            recorded = json.loads(read_content(conn, editor.response_artifact_id))
        body = json.loads(recorded["model_text"])["report_markdown"].encode()
        assert len(body) > 6000 and editor.result.report_artifact is not None
        response = client.get(outputs[2][1])
        assert response.status_code == 200
        with ZipFile(io.BytesIO(response.content)) as archive:
            assert archive.namelist() == ["report.md"]
            assert archive.read("report.md") == body

        illustrated = outputs[0][2]
        guide = style_request()
        assert (
            client.post("/api/style-guides", json=guide.model_dump(mode="json")).status_code == 201
        )
        draft = {
            "id": str(uuid4()),
            "title": "Illustrated study report",
            "run_id": str(illustrated.id),
            "attempt_id": str(illustrated.model_attempts[-1].id),
            "style_guide_id": str(guide.id),
            "source_format": "session_markdown",
        }
        wrong_attempt = {**draft, "attempt_id": str(illustrated.model_attempts[0].id)}
        response = client.post("/api/reports", json=wrong_attempt)
        assert response.status_code == 422 and "final report editor" in response.text
        response = client.post("/api/reports", json=draft)
        assert response.status_code == 201, response.text
        saved = response.json()
        assert client.post("/api/reports", json=draft).json() == saved
        assert saved["provenance"]["renderer"] == "study-markdown-1"
        assert saved["provenance"]["recorded_urls"] == ["https://example.org/data"]
        assert saved["provenance"]["attempt"]["id"] == draft["attempt_id"]
        assert (
            saved["sections"][0]["body"]
            == f"# First study\n\n![Observed series](figure.png){references}"
        )
        export = client.get(f"/api/reports/{draft['id']}/export")
        assert export.status_code == 200, export.text
        with ZipFile(io.BytesIO(export.content)) as archive:
            assert archive.read("study-files/figure.png") == CHART
            assert archive.read("study-files/series.csv") == b"period,value\n1,4"
            assert archive.read("study-files/report.md").decode() == saved["sections"][0]["body"]
            html = archive.read("index.html").decode()
            assert 'src="study-files/figure.png"' in html
            assert 'href="https://example.org/data"' in html
            assert 'href="https://example.org/unseen"' not in html
        assert runs.get(illustrated.id) == illustrated
        uploaded_text = client.post(
            "/api/reports",
            json={
                **draft,
                "id": str(uuid4()),
                "run_id": str(final.id),
                "attempt_id": str(editor.id),
            },
        )
        assert uploaded_text.status_code == 201, uploaded_text.text
        assert uploaded_text.json()["sections"][0]["body"].encode() == body
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


def test_report_lookup_finds_exact_study_heads_outside_the_recent_list(database):
    provider = SessionProvider()
    runs = RunStore(database, provider)
    original = evidence(database, text="Synthetic release used in the study.")
    additional = evidence(database, text="Synthetic source added during editing.")
    start = request(brief="Older study report", review_mode="never", evidence_ids=[original.id])
    path = "/api/reports"
    with owner_client(create_app(database, provider), workers=False) as client:
        response = client.post("/api/research-sessions", json=start.model_dump(mode="json"))
        assert response.status_code == 202, response.text
        assert RunWorker(runs).run_once()
        study = runs.get(start.id)
        assert study.status == "completed", study.stop_reason
        editor = study.model_attempts[-1]
        researcher = next(item for item in study.model_attempts if item.path == "root/team/agent-1")
        calls_after_study = len(provider.calls)
        guide = style_request()
        response = client.post("/api/style-guides", json=guide.model_dump(mode="json"))
        assert response.status_code == 201, response.text

        def create_report(attempt, source_format=None):
            response = client.post(
                path,
                json={
                    "id": str(uuid4()),
                    "title": "Original report title",
                    "run_id": str(study.id),
                    "attempt_id": str(attempt.id),
                    "style_guide_id": str(guide.id),
                    "source_format": source_format,
                },
            )
            assert response.status_code == 201, response.text
            return response.json()

        first = create_report(editor, "session_markdown")
        second = create_report(editor, "session_markdown")
        generic = create_report(editor)
        create_report(researcher)

        response = client.post(
            f"{path}/revisions",
            json={
                "id": str(uuid4()),
                "base_revision_id": first["id"],
                "title": "Renamed by the editor",
                "style_guide_id": str(guide.id),
                "sections": first["sections"],
                "evidence_ids": [str(original.id), str(additional.id)],
                "change_note": "Add a supplementary source.",
            },
        )
        assert response.status_code == 201, response.text
        head = response.json()
        assert head["provenance"] == first["provenance"]

        # Seed enough unrelated heads to move both study drafts out of the recent list.
        with database.connection() as conn:
            conn.execute(
                "INSERT INTO report_revisions "
                "(id,series_id,version,request_hash,document,created_at) "
                "SELECT copy.id,copy.id,1,template.request_hash, "
                "template.document || jsonb_build_object("
                "'id',copy.id,'series_id',copy.id,'created_at',CURRENT_TIMESTAMP), "
                "CURRENT_TIMESTAMP "
                "FROM report_revisions template CROSS JOIN unnest(%s::uuid[]) AS copy(id) "
                "WHERE template.id = %s",
                ([uuid4() for _ in range(100)], generic["id"]),
            )

        recent = client.get(path).json()
        assert len(recent) == 100
        assert {head["id"], second["id"]}.isdisjoint(item["id"] for item in recent)
        origin = {"study_run_id": str(study.id), "study_attempt_id": str(editor.id)}
        response = client.get(path, params=origin)
        assert response.status_code == 200, response.text
        matches = response.json()
        assert [item["id"] for item in matches] == [head["id"], second["id"]]
        assert matches[0]["series_id"] == first["id"] and matches[0]["version"] == 2
        assert matches[0]["title"] == "Renamed by the editor"
        assert client.get(f"{path}/{first['id']}").json()["current_revision_id"] == head["id"]
        other_attempt = {**origin, "study_attempt_id": str(researcher.id)}
        assert client.get(path, params=other_attempt).json() == []
        assert client.get(path, params={**origin, "study_run_id": str(uuid4())}).json() == []
        assert client.get(path, params={"study_run_id": str(study.id)}).status_code == 422
        client.cookies.clear()
        assert client.get(path, params=origin).status_code == 401
        assert len(provider.calls) == calls_after_study
