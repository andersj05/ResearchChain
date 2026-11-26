"""Resolve Python inputs from pinned evidence and this run's confirmed research receipts."""

import base64
import json
import re
from pathlib import PurePosixPath
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

from researchchain.analyst_workspace import MAX_FILES, MAX_INPUT_BYTES, MAX_INPUT_FILE_BYTES
from researchchain.artifacts import put_artifact, read_content
from researchchain.research_directions import read_report_request
from researchchain.research_models import StoredResearchResult, TeamPlan, WorkspaceFile
from researchchain.research_prompt import PreparedResearch, json_bytes
from researchchain.research_swarm_workspace import confirmed_swarm_worker as confirmed_swarm_worker
from researchchain.research_swarm_workspace import swarm_handoff as swarm_handoff
from researchchain.research_swarm_workspace import swarm_material


def generated_files(
    conn: Connection[DictRow],
    run_id: UUID,
    prepared: PreparedResearch,
    history: list[StoredResearchResult],
) -> dict[str, WorkspaceFile]:
    files: dict[str, WorkspaceFile] = {}
    prior = prepared.previous
    # The text input can also come from the brief or a note. Never dereference a
    # content hash from model/user text without a matching completed run receipt.
    if isinstance(prior, StoredResearchResult) and prior.workspace_files:
        receipt = conn.execute(
            "SELECT 1 FROM research_attempts WHERE run_id = %s AND status = 'completed' "
            "AND result = %s LIMIT 1",
            (run_id, Jsonb(prior.model_dump(mode="json"))),
        ).fetchone()
        if receipt:
            files.update((file.name, file) for file in prior.workspace_files)
    for result in history:
        if result.workspace_activity:
            files.update((file.name, file) for file in result.workspace_activity.files)
    return files


def _recorded_team(
    conn: Connection[DictRow], run_id: UUID, path: str
) -> tuple[TeamPlan, list[tuple[UUID, str, StoredResearchResult]]]:
    """Resolve the plan and one final receipt per assigned lane at this exact occurrence."""
    prefix = path + "/"
    rows = conn.execute(
        "SELECT id, path, result FROM research_attempts WHERE run_id = %s "
        "AND starts_with(path, %s) AND status = 'completed' AND result->>'next_lead' IS NULL",
        (run_id, prefix),
    ).fetchall()
    plan: TeamPlan | None = None
    lanes: dict[int, tuple[UUID, str, StoredResearchResult]] = {}
    for row in rows:
        relative = row["path"][len(prefix) :]
        if relative == "plan":
            plan = StoredResearchResult.model_validate(row["result"]).team_plan
            continue
        lane = re.fullmatch(r"agent-([1-4])(?:/analyst-pass-(?:[2-9]|[1-9][0-9]+))?", relative)
        if lane:
            index = int(lane[1])
            result = StoredResearchResult.model_validate(row["result"])
            if index in lanes or result.workspace_activity or result.team_plan:
                raise ValueError("Expected one final research result per assigned agent.")
            lanes[index] = (row["id"], row["path"], result)
    if plan is None or set(lanes) != set(range(1, len(plan.assignments) + 1)):
        raise ValueError("The research team is missing its recorded plan or final agent results.")
    return plan, [lanes[index] for index in range(1, len(lanes) + 1)]


def _handoff_material(
    path: str, plan: TeamPlan, lanes: list[tuple[UUID, str, StoredResearchResult]]
) -> tuple[str, dict[str, WorkspaceFile]]:
    agents = []
    files: dict[str, WorkspaceFile] = {}
    questions = [plan.review_question] if plan.review_question else []
    for index, (assignment, receipt) in enumerate(zip(plan.assignments, lanes, strict=True), 1):
        attempt_id, attempt_path, result = receipt
        if result.review_question:
            questions.append(result.review_question)
        manifest = []
        for number, file in enumerate(sorted(result.workspace_files, key=lambda f: f.name), 1):
            prefix = f"agent-{index}-{number}-"
            filename = PurePosixPath(file.name)
            # The ordinal keeps aliases distinct even when long names share their first 96 bytes.
            stem = filename.stem[: 96 - len(prefix) - len(filename.suffix)]
            alias = f"{prefix}{stem}{filename.suffix}"
            files[alias] = file.model_copy(update={"name": alias})
            manifest.append(
                {
                    "workspace_name": file.name,
                    "input_name": alias,
                    **file.model_dump(mode="json", exclude={"name"}),
                }
            )
        trace = result.web_research
        agents.append(
            {
                "title": assignment.title,
                "objective": assignment.objective,
                "attempt_id": str(attempt_id),
                "attempt_path": attempt_path,
                "findings": result.conclusion,
                "limitations": result.limitations,
                "hypotheses": [h.model_dump(mode="json") for h in result.hypotheses],
                "unresolved_questions": result.unresolved_questions,
                "evidence_requests": [r.model_dump(mode="json") for r in result.evidence_requests],
                "review_question": result.review_question,
                "web_sources": [s.model_dump(mode="json") for s in trace.sources] if trace else [],
                "web_observed_at": trace.observed_at.isoformat() if trace else None,
                "web_receipt_truncated": trace.truncated if trace else False,
                "sec_financials": result.sec_financials.model_dump(mode="json")
                if result.sec_financials
                else None,
                "files": manifest,
            }
        )
    distinct = dict.fromkeys(question.strip() for question in questions if question.strip())
    packet = {
        "format": "research-team-handoff-1",
        "team_path": path,
        "review_question": "\n".join(list(distinct)[:4]) or None,
        "agents": agents,
    }
    return json_bytes(packet).decode(), files


def team_handoff(
    conn: Connection[DictRow],
    run_id: UUID,
    path: str,
    plan: TeamPlan,
    results: list[StoredResearchResult],
) -> str:
    recorded, lanes = _recorded_team(conn, run_id, path)
    if plan != recorded or results != [result for _, _, result in lanes]:
        raise ValueError("The research team handoff differs from its recorded plan or findings.")
    packet, _ = _handoff_material(path, recorded, lanes)
    return packet


def team_workspace_files(
    conn: Connection[DictRow], run_id: UUID, source_path: str, context: str
) -> dict[str, WorkspaceFile]:
    """source_path comes from the pinned binding. Never resolve a path or blob ID from context."""
    swarm = conn.execute(
        "SELECT 1 FROM research_attempts WHERE run_id=%s AND path=%s AND status='completed' "
        "AND result ? 'swarm_plan'",
        (run_id, source_path + "/plan"),
    ).fetchone()
    if swarm:
        request = read_report_request(conn, run_id)
        handoff = json.loads(context) if request else None
        early = isinstance(handoff, dict) and handoff.get("handoff_requested") is True
        packet, files = swarm_material(conn, run_id, source_path, early=early)
    else:
        plan, lanes = _recorded_team(conn, run_id, source_path)
        packet, files = _handoff_material(source_path, plan, lanes)
    if packet != context:
        raise ValueError("The bound team output differs from the confirmed research handoff.")
    return files


def staged_files(
    prepared: PreparedResearch,
    generated: dict[str, WorkspaceFile],
    *,
    team_files: dict[str, WorkspaceFile] | None = None,
) -> dict[str, str]:
    files = {name: file.artifact_id for name, file in generated.items()}
    sizes = {name: file.byte_size for name, file in generated.items()}
    for evidence_id, source in prepared.sources.items():
        artifact = source.get("artifact")
        if not artifact or source["availability"] != "available":
            continue
        suffix = {
            "text/plain": "txt",
            "text/csv": "csv",
            "text/tab-separated-values": "tsv",
            "image/png": "png",
            "image/jpeg": "jpg",
            "image/webp": "webp",
            "application/pdf": "pdf",
        }.get(artifact["media_type"])
        if suffix:
            name = f"evidence-{evidence_id}.{suffix}"
            files[name] = artifact["id"]
            sizes[name] = artifact["byte_size"]
    if team_files:
        used = sum(sizes.values())
        omitted = []
        for alias, file in team_files.items():
            if (
                alias in files
                or len(files) >= MAX_FILES
                or file.byte_size > MAX_INPUT_FILE_BYTES
                or used + file.byte_size > MAX_INPUT_BYTES
            ):
                omitted.append(alias)
                continue
            files[alias] = file.artifact_id
            used += file.byte_size
        if omitted:
            prepared.instructions += (
                "\nThese team inputs could not be staged alongside the current files within "
                "the Python workspace limits or share a name with a local file: "
                + ", ".join(omitted[:16])
                + (f" and {len(omitted) - 16} more" if len(omitted) > 16 else "")
                + ". Their originals remain in the producing agents' receipts."
            )
    return files


def save_files(conn: Connection[DictRow], files: dict[str, bytes]) -> list[WorkspaceFile]:
    saved = []
    for name, content in files.items():
        artifact = put_artifact(conn, content, name)
        saved.append(
            WorkspaceFile(
                name=name,
                artifact_id=artifact.id,
                media_type=artifact.media_type,
                byte_size=artifact.byte_size,
            )
        )
    return saved


def load_files(conn: Connection[DictRow], inputs: dict[str, str]) -> dict[str, bytes]:
    sizes = conn.execute(
        "SELECT id, byte_size FROM artifact_blobs WHERE id = ANY(%s)", (list(inputs.values()),)
    ).fetchall()
    byte_sizes = {row["id"]: row["byte_size"] for row in sizes}
    if any(key not in byte_sizes for key in inputs.values()):
        raise ValueError("A saved Python workspace input is missing.")
    if (
        len(inputs) > MAX_FILES
        or sum(byte_sizes[key] for key in inputs.values()) > MAX_INPUT_BYTES
        or any(size > MAX_INPUT_FILE_BYTES for size in byte_sizes.values())
    ):
        raise ValueError("Python workspace inputs exceed 64 files, 8 MiB per file or 24 MiB total.")
    return {name: read_content(conn, key) for name, key in inputs.items()}


def attach_chart(
    conn: Connection[DictRow],
    prepared: PreparedResearch,
    history: list[StoredResearchResult],
    input_limit: int,
) -> None:
    """Offer visual inspection of the most recent action's chart within the owner's input budget."""
    activity = history[-1].workspace_activity if history else None
    if not activity:
        return
    chart = next((file for file in activity.files if file.media_type == "image/png"), None)
    if not chart:
        return
    label = f"Generated chart {chart.name} from the previous Python action (untrusted output)."
    attachment = {"type": "input_image", "image_url": "data:image/png;base64,", "detail": "auto"}
    item = {"role": "user", "content": [{"type": "input_text", "text": label}, attachment]}
    remaining = input_limit - len(json_bytes(prepared.request_body()))
    if len(json_bytes(item)) + 1 + 4 * ((chart.byte_size + 2) // 3) <= remaining:
        attachment["image_url"] += base64.b64encode(read_content(conn, chart.artifact_id)).decode()
        prepared.input_items.append(item)
