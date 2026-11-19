"""Script observations for the synthetic EquityCats loop, without external requests."""

import json
from dataclasses import replace

from researchchain.providers.chatgpt_plan import Completion
from researchchain.research_prompt import PreparedResearch

BRIEF_PREFIX = "Follow an analyst lead. Synthetic EquityCats loop fixture."


def equitycats_completion(
    prepared: PreparedResearch,
    completion: Completion,
    *,
    ready_on: int | None = 2,
    record_sources: bool = True,
) -> Completion:
    packet = json.loads(prepared.input_items[0]["content"][0]["text"])
    if not packet["brief"].startswith(BRIEF_PREFIX):
        return completion

    prior = packet["prior_result"]
    context = prior["conclusion"] if prior else packet["additional_context"]
    pass_number = int(context.removeprefix("Pass ").split(".", 1)[0])
    instructions = prepared.instructions
    document = json.loads(completion.text)
    web_research = completion.web_research
    if "Use the owner's brief and this pass's test." in instructions:
        conclusion = "Synthetic pricing baseline for rates and equities."
    elif "Act as a second analyst." in instructions:
        conclusion = "Synthetic rival explains the move through shared duration exposure."
    elif "Review the competing explanations and verify the decisive evidence" in instructions:
        if ready_on is not None and pass_number >= ready_on:
            conclusion = "Synthetic audit reproduced the matched-window comparison."
            document["revision_summary"] = "ready"
            document["unresolved_questions"] = []
            document["evidence_requests"] = []
        else:
            conclusion = "Synthetic audit found a timestamp gap."
            document["revision_summary"] = "needs_more"
            document["unresolved_questions"] = ["Which market closed first?"]
            document["evidence_requests"] = [
                {
                    "question": "Are the timestamps comparable?",
                    "source_needed": "Synthetic instrument observations with timestamps.",
                    "why": "The baseline offsets may explain the apparent gap.",
                }
            ]
        if not record_sources:
            web_research = None
    elif "Prepare a short decision brief from the audited case." in instructions:
        conclusion = "Synthetic proposal favors the rival while keeping the priced baseline fixed."
    else:
        assert "Write the report draft in conclusion." in instructions
        conclusion = f"Synthetic memo with reviewer judgment. {packet['human_feedback']}"
    document["conclusion"] = f"Pass {pass_number}. {conclusion}"
    return replace(completion, text=json.dumps(document), web_research=web_research)
