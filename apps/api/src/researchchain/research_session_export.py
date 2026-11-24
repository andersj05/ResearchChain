"""Package a completed session's editor workspace with its original relative filenames."""

from io import BytesIO
from pathlib import PureWindowsPath
from uuid import UUID
from zipfile import ZIP_DEFLATED, ZipFile

from researchchain.analyst_workspace import EXPORT_TYPES, FILENAME
from researchchain.artifacts import EvidenceError, read_content
from researchchain.database import Database
from researchchain.report_export import MAX_EXPORT_BYTES
from researchchain.research_models import StoredResearchResult
from researchchain.research_sessions import SESSION_VERSION
from researchchain.revisions import ConflictError, NotFoundError


def export_session_report(database: Database, run_id: UUID) -> bytes:
    with database.connection() as conn, conn.transaction():
        conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        session = conn.execute(
            "SELECT c.terminal_status FROM run_controls c JOIN run_research_manifests m "
            "ON m.run_id = c.run_id WHERE c.run_id = %s "
            "AND m.manifest->'tool_config'->>'session' = %s",
            (run_id, SESSION_VERSION),
        ).fetchone()
        if not session:
            raise NotFoundError("Research session not found.")
        if session["terminal_status"] != "completed":
            raise ConflictError("The report download is available after the session completes.")

        # Only this version's pinned report editor can publish the archive inventory.
        rows = conn.execute(
            "SELECT result FROM research_attempts WHERE run_id = %s AND status = 'completed' "
            "AND path ~ '^root/report(/analyst-pass-([2-9]|[1-9][0-9]+))?$'",
            (run_id,),
        )
        produced: set[tuple[str, str]] = set()
        finals = []
        for row in rows:
            result = StoredResearchResult.model_validate(row["result"])
            action = result.workspace_activity
            if action and action.status in {"completed", "failed"}:
                produced.update((file.name, file.artifact_id) for file in action.files)
            elif result.next_lead is None and action is None:
                finals.append(result)
        if len(finals) != 1:
            raise NotFoundError("The session has no final report editor receipt.")
        final = finals[0]
        files = final.workspace_files
        if final.report_artifact is not None:
            report = final.report_artifact
            if report.name != "report.md" or report not in files:
                raise EvidenceError(
                    "The report editor's saved Markdown differs from its inventory."
                )
            produced.add((report.name, report.artifact_id))
        if not any(file.name.lower().endswith(".md") for file in files):
            raise NotFoundError("The report editor did not save a Markdown file.")
        if sum(file.byte_size for file in files) > MAX_EXPORT_BYTES:
            raise EvidenceError("The editor's files exceed 64 MiB. Download them individually.")
        names = set()
        output = BytesIO()
        with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
            for file in files:
                if (file.name, file.artifact_id) not in produced:
                    raise EvidenceError("A report file has no matching output from this editor.")
                path = PureWindowsPath(file.name)
                if (
                    not FILENAME.fullmatch(file.name)
                    or path.is_reserved()
                    or path.suffix.lower() not in EXPORT_TYPES
                    or file.name.lower() in names
                ):
                    raise EvidenceError(
                        "The editor's filenames cannot be extracted together on Windows. "
                        "Download the files individually."
                    )
                names.add(file.name.lower())
                content = read_content(conn, file.artifact_id)
                if len(content) != file.byte_size:
                    raise EvidenceError("The report file size differs from its saved receipt.")
                archive.writestr(file.name, content)
        return output.getvalue()
