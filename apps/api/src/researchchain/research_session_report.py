"""Confirm a session editor's full report as part of its final response transaction."""

import json

from psycopg import Connection
from psycopg.rows import DictRow

from researchchain.artifacts import read_content
from researchchain.research_models import StoredResearchResult
from researchchain.research_prompt import PreparedResearch
from researchchain.research_workspace import save_files

REPORT_VERSION = "editor-markdown-1"


def prepare_editor(prepared: PreparedResearch, limit: int) -> None:
    prepared.instructions += (
        "\nDeliver the complete report as report.md. If you have already saved it in your Python "
        "workspace, set report_markdown to null. You may instead put the complete Markdown text "
        "in report_markdown in your final answer. Link any figures by their saved relative "
        "filenames. Keep the short conclusion and full report separate."
    )
    prepared.schema["properties"]["report_markdown"] = {
        "anyOf": [{"type": "string", "minLength": 1, "maxLength": limit}, {"type": "null"}]
    }
    prepared.schema["required"].append("report_markdown")


def editor_output(text: str, limit: int) -> tuple[str, bytes | None]:
    answer = json.loads(text)
    if not isinstance(answer, dict):
        raise ValueError("The editor returned an invalid result.")
    markdown = answer.pop("report_markdown", None)
    if markdown is None:
        return json.dumps(answer), None
    if not isinstance(markdown, str) or len(markdown) > limit or "\x00" in markdown:
        raise ValueError("The editor's Markdown must be text within the response limit.")
    try:
        content = markdown.encode("utf-8")
    except UnicodeError:
        raise ValueError("The editor's Markdown must contain valid Unicode.") from None
    return json.dumps(answer), content


def confirm_editor_report(
    conn: Connection[DictRow], result: StoredResearchResult, markdown: bytes | None
) -> None:
    for file in result.workspace_files:
        if file.name == "report.md":
            original = read_content(conn, file.artifact_id)
            if original.decode("utf-8-sig").strip():
                return
    if markdown is None or not markdown.decode("utf-8-sig").strip():
        raise ValueError(
            "The report editor finished without saving a nonempty report.md or supplying the "
            "full Markdown report. Inspect the editor's saved response."
        )
    (report,) = save_files(conn, {"report.md": markdown})
    result.workspace_files = [file for file in result.workspace_files if file.name != "report.md"]
    result.workspace_files.append(report)
    result.report_artifact = report
