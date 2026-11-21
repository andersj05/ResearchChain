"""Build a multi-lead handoff exclusively from journaled assignments and final receipts."""

import re
from collections import defaultdict
from itertools import zip_longest
from pathlib import PurePosixPath
from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from researchchain.graph import SwarmConfig
from researchchain.research_models import StoredResearchResult, TeamAssignment, WorkspaceFile
from researchchain.research_perspectives import perspective_answers
from researchchain.research_prompt import json_bytes

type WorkerReceipt = tuple[UUID, str, StoredResearchResult]


def _confirmed_workers(
    conn: Connection[DictRow], run_id: UUID, bases: list[str]
) -> dict[str, WorkerReceipt]:
    if not bases:
        return {}
    rows = conn.execute(
        "SELECT id,path,result FROM research_attempts WHERE run_id=%s AND status='completed' "
        "AND result->>'next_lead' IS NULL AND result->>'workspace_activity' IS NULL "
        "AND regexp_replace(path,'/analyst-pass-[0-9]+$','')=ANY(%s)",
        (run_id, bases),
    )
    receipts: dict[str, WorkerReceipt] = {}
    for row in rows:
        base = re.sub(r"/analyst-pass-(?:[2-9]|[1-9][0-9]+)$", "", row["path"])
        if base not in bases:
            continue
        result = StoredResearchResult.model_validate(row["result"])
        if base in receipts or result.swarm_action or result.swarm_plan or result.team_plan:
            raise ValueError("The assigned investigator has conflicting final receipts.")
        receipts[base] = row["id"], row["path"], result
    return receipts


def confirmed_swarm_worker(
    conn: Connection[DictRow], run_id: UUID, base_path: str
) -> WorkerReceipt | None:
    return _confirmed_workers(conn, run_id, [base_path]).get(base_path)


def _excerpt(value: str, size: int) -> str:
    return value if len(value) <= size else value[: size - 1] + "…"


def _worker_packet(
    lead: int, agent: int, assignment: TeamAssignment, receipt: WorkerReceipt
) -> tuple[dict[str, Any], dict[str, WorkspaceFile]]:
    attempt_id, path, result = receipt
    files = {}
    listed: list[dict[str, str]] = []
    for number, file in enumerate(sorted(result.workspace_files, key=lambda item: item.name), 1):
        prefix = f"lead-{lead}-agent-{agent}-{number}-"
        filename = PurePosixPath(file.name)
        alias = prefix + filename.stem[: 96 - len(prefix) - len(filename.suffix)] + filename.suffix
        files[alias] = file.model_copy(update={"name": alias})
        if len(listed) < 6:
            listed.append(
                {"workspace_name": file.name, "input_name": alias, "media_type": file.media_type}
            )
    trace = result.web_research
    sources: list[dict[str, Any]] = []
    size = 0
    for source in sorted(trace.sources, key=lambda s: not s.cited) if trace else []:
        item = {"url": source.url, "title": _excerpt(source.title, 200), "cited": source.cited}
        length = len(json_bytes(item))
        if len(sources) < 6 and size + length <= 4096:
            sources.append(item)
            size += length
    citations = [c for h in result.hypotheses for c in h.citations]
    return {
        "lead": lead,
        "agent": agent,
        "title": assignment.title,
        "objective": _excerpt(assignment.objective, 500),
        "attempt_id": str(attempt_id),
        "attempt_path": path,
        "findings": _excerpt(result.conclusion, 1200),
        "limitations": [_excerpt(s, 240) for s in result.limitations[:3]],
        "limitations_omitted": max(0, len(result.limitations) - 3),
        "review_question": result.review_question,
        "web_sources": sources,
        "web_sources_omitted": len(trace.sources) - len(sources) if trace else 0,
        "web_receipt_truncated": trace.truncated if trace else False,
        "web_observed_at": trace.observed_at.isoformat() if trace else None,
        "evidence_citations": [
            {
                "evidence_id": str(c.evidence_id),
                "basis": c.basis,
                "locator": _excerpt(c.locator, 200),
            }
            for c in citations[:4]
        ],
        "evidence_citations_omitted": max(0, len(citations) - 4),
        "sec_financials": result.sec_financials.model_dump(
            mode="json", exclude={"detail", "issuer"}
        )
        if result.sec_financials
        else None,
        "files": listed,
        "files_omitted_from_summary": len(files) - len(listed),
    }, files


def swarm_material(
    conn: Connection[DictRow], run_id: UUID, path: str, config: SwarmConfig | None = None
) -> tuple[str, dict[str, WorkspaceFile]]:
    prefix = path + "/"
    rows = conn.execute(
        "SELECT id,path,result FROM research_attempts WHERE run_id=%s AND starts_with(path,%s) "
        "AND status='completed' AND (result ? 'swarm_plan' OR result ? 'swarm_action')",
        (run_id, prefix),
    )
    plan = None
    turns: dict[int, dict[int, WorkerReceipt]] = defaultdict(dict)
    for row in rows:
        relative = row["path"][len(prefix) :]
        if relative == "plan":
            plan = StoredResearchResult.model_validate(row["result"]).swarm_plan
        elif match := re.fullmatch(r"lead-([1-4])/turn-([1-9]|1[0-2])", relative):
            turns[int(match[1])][int(match[2])] = (
                row["id"],
                row["path"],
                StoredResearchResult.model_validate(row["result"]),
            )
    if (
        not plan
        or (config and len(plan.leads) != config.lead_count)
        or set(turns) != set(range(1, len(plan.leads) + 1))
    ):
        raise ValueError("The swarm roster and its recorded leads do not match.")
    answers = {
        a.action_path: a
        for a in perspective_answers(
            conn,
            run_id,
            (
                p
                for items in turns.values()
                for _, p, r in items.values()
                if r.swarm_action and r.swarm_action.action == "ask_expert"
            ),
        )
    }
    leads = []
    workers: dict[str, tuple[int, int, TeamAssignment]] = {}
    for index, mandate in enumerate(plan.leads, 1):
        actions = turns[index]
        expected = list(range(1, len(actions) + 1))
        if sorted(actions) != expected or (config and len(actions) > config.max_lead_turns):
            raise ValueError("The lead's recorded turn sequence differs from its assignment.")
        decisions = []
        count = 0
        for number in expected:
            attempt_id, action_path, result = actions[number]
            action = result.swarm_action
            if action is None or (number == len(actions)) != (action.action == "finish"):
                raise ValueError(
                    "The lead needs a single final decision after its preceding turns."
                )
            decision: dict[str, Any] = {
                "action": action.action,
                "attempt_id": str(attempt_id),
                "attempt_path": action_path,
            }
            if action.action == "delegate":
                decision["rationale"] = _excerpt(action.rationale, 400)
                decision["workers"] = list(range(count + 1, count + 1 + len(action.assignments)))
                for assignment in action.assignments:
                    count += 1
                    if count > (config.researchers_per_lead if config else 20):
                        raise ValueError("The lead exceeded its pinned investigator count.")
                    workers[f"{path}/lead-{index}/agent-{count}"] = index, count, assignment
            elif action.action == "ask_expert":
                reply = answers.get(action_path)
                if (
                    (config and not config.allow_consultations)
                    or not reply
                    or reply.decision != "approve"
                ):
                    raise ValueError(
                        "The lead has a consultation without its owner's recorded answer."
                    )
                decision.update(
                    question=action.consultation.question,
                    thesis=_excerpt(action.consultation.thesis, 500),
                    owner_feedback=_excerpt(reply.feedback, 1200),
                    feedback_excerpted=len(reply.feedback) > 1200,
                    interrupt_id=reply.interrupt_id,
                )
            else:
                decision["findings"] = _excerpt(action.findings, 3000)
                decision["limitations"] = [_excerpt(s, 300) for s in action.limitations]
            decisions.append(decision)
        leads.append({"lead": index, **mandate.model_dump(), "turns": decisions})
    receipts = _confirmed_workers(conn, run_id, list(workers))
    if workers.keys() != receipts.keys():
        raise ValueError("The swarm is missing a final receipt for an assigned investigator.")
    agents = []
    files_by_worker = {}
    questions = []
    for base, (index, number, assignment) in workers.items():
        agent, files = _worker_packet(index, number, assignment, receipts[base])
        agents.append(agent)
        files_by_worker[number, index] = files
        if agent["review_question"]:
            questions.append(agent["review_question"])
    # Interleave first files from different workers before extra files from a single lane.
    ordered = (files_by_worker[key].items() for key in sorted(files_by_worker))
    files = {}
    for batch in zip_longest(*ordered):
        for entry in batch:
            if entry is not None:
                alias, file = entry
                files[alias] = file
    packet = {
        "format": "research-swarm-handoff-1",
        "team_path": path,
        "leads": leads,
        "agents": agents,
        "review_question": "\n".join(list(dict.fromkeys(questions))[:4]) or None,
        "receipt_note": "Findings and lists are excerpts. Each attempt path and ID identifies "
        "its full saved receipt. The workspace tool lists the files available within its limits.",
    }
    return json_bytes(packet).decode(), files


def swarm_handoff(conn: Connection[DictRow], run_id: UUID, path: str, config: SwarmConfig) -> str:
    packet, _ = swarm_material(conn, run_id, path, config)
    return packet
