"""Synthetic lead tool calls and named workspace files for the browser rehearsal."""

import asyncio
import json
import os
from pathlib import Path
from uuid import UUID, uuid4

from test_research_contracts import result_document

from researchchain.providers.chatgpt_plan import Completion
from researchchain.research_models import ProviderModel

ASTRA = "gpt-6.2-astra"
SOL = "gpt-6.2-sol"
SWARM_BRIEF = "Swarm browser study "
FEEDBACK = "Focus on inventories and challenge the timing."
QUESTION = "Which supply constraint should guide the trade thesis?"


def swarm_models():
    return [
        ProviderModel(
            slug=slug,
            display_name=label,
            reasoning_efforts=["low", "medium", "high", "xhigh"],
            default_reasoning_effort="medium",
            supports_verbosity=True,
            default_verbosity="medium",
        )
        for slug, label in [(ASTRA, "Astra 6.2"), (SOL, "Sol 6.2")]
    ]


def result(model, *, answer=None, tool=None, arguments=None):
    identity = uuid4().hex
    text = json.dumps(answer) if answer is not None else ""
    if tool:
        output = {
            "id": identity,
            "call_id": "call_" + identity,
            "type": "function_call",
            "status": "completed",
            "namespace": "research",
            "name": tool,
            "arguments": json.dumps(arguments),
        }
    else:
        output = {
            "id": identity,
            "type": "message",
            "role": "assistant",
            "status": "completed",
            "content": [{"type": "output_text", "text": text, "annotations": []}],
        }
    usage = {"input_tokens": 30, "output_tokens": 15, "total_tokens": 45}
    return Completion(
        model,
        text,
        identity,
        usage,
        model + "-snapshot",
        analyst_response={
            "id": identity,
            "object": "response",
            "status": "completed",
            "model": model,
            "output": [output],
            "usage": usage,
        },
    )


def lead_turn(model, state):
    assert model == ASTRA
    title = state["mandate"]["title"]
    if title == "Supply" and state["turn"] == 1:
        return result(
            model,
            tool="ask_expert",
            arguments={
                "thesis": "Supply timing may reverse the synthetic trade case.",
                "question": QUESTION,
                "options": ["Capacity", "Inventories"],
            },
        )
    if title == "Demand" and state["turn"] == 1:
        tasks = ["Orders", "Backlog"]
    elif title == "Demand" and state["turn"] == 2:
        assert state["history"][0]["workers"]
        return result(
            model,
            tool="ask_expert",
            arguments={
                "thesis": "Orders and backlog may use different cutoffs.",
                "question": "Which release window should determine the comparison?",
                "options": [],
            },
        )
    elif title == "Supply" and state["turn"] == 2:
        assert any(item.get("owner_answer") == FEEDBACK for item in state["history"])
        tasks = ["Inventory timing"]
    else:
        assert any(item.get("workers") for item in state["history"])
        return result(
            model,
            tool="finish",
            arguments={
                "findings": f"{title} reviewed its researchers' saved findings.",
                "limitations": ["Synthetic observations only."],
            },
        )
    return result(
        model,
        tool="delegate",
        arguments={
            "rationale": FEEDBACK if title == "Supply" else "Check both measures independently.",
            "assignments": [
                {
                    "title": task,
                    "objective": f"Investigate {task} and save a synthetic observation.",
                }
                for task in tasks
            ],
        },
    )


async def swarm_completion(prepared, on_delta):
    data = {}
    for item in prepared.input_items:
        if item.get("role") != "user":
            continue
        for part in item.get("content", []):
            if isinstance(part, dict) and part.get("type") == "input_text":
                try:
                    packet = json.loads(part["text"])
                except ValueError:
                    continue
                if isinstance(packet, dict):
                    data.update(packet)
    brief = data.get("brief", "")
    if not brief.startswith(SWARM_BRIEF):
        return None
    study_id = UUID(brief[len(SWARM_BRIEF) :])
    on_delta("Synthetic research in progress.")
    model = prepared.model
    if "swarm_roster" in data:
        assert model == ASTRA
        return result(
            model,
            answer={
                "leads": [
                    {"title": "Demand", "objective": "Assess synthetic demand and demand timing."},
                    {"title": "Supply", "objective": "Investigate which constraint matters."},
                ]
            },
        )
    if "swarm_lead" in data:
        return lead_turn(model, data["swarm_lead"])
    continued = any(item.get("type") == "function_call_output" for item in prepared.input_items)
    assignment = data.get("research_assignment")
    if assignment:
        assert model == SOL
        title = assignment["title"]
        if title == "Inventory timing":
            assert any(
                item["answer"] == FEEDBACK for item in data["swarm_delegation"]["owner_answers"]
            )
        if not continued:
            if title in ("Orders", "Backlog"):
                observed = (
                    Path(os.environ["RESEARCHCHAIN_ACCESS_DIRECTORY"])
                    / f"swarm-observed-{study_id}"
                )
                async with asyncio.timeout(90):
                    while not observed.is_file():
                        await asyncio.sleep(0.1)
            script = (
                "from pathlib import Path\n"
                f"Path('outputs/observations.csv').write_text({title!r}, encoding='utf-8')"
            )
            return result(model, tool="run_python", arguments={"purpose": title, "script": script})
    else:
        title = "Editor"
        if not continued:
            script = (
                "from pathlib import Path\n"
                "rows = sorted(p.read_text() for p in Path('.').glob('*-observations.csv'))\n"
                "assert rows == ['Backlog', 'Inventory timing', 'Orders'], rows\n"
                "report = '# Synthetic swarm report\\n\\n' + ', '.join(rows)\n"
                f"report += '\\n\\n' + {FEEDBACK!r}\n"
                "Path('outputs/report.md').write_text(report, encoding='utf-8')"
            )
            assert FEEDBACK in data["additional_context"]
            return result(model, tool="run_python", arguments={"purpose": title, "script": script})
    answer = result_document("custom")
    answer.update(hypotheses=[], conclusion=f"Saved synthetic observations for {title}.")
    if assignment:
        answer["review_question"] = None
    else:
        answer["report_markdown"] = None
    return result(model, answer=answer)
