"""Script observations for the synthetic EquityCats loop, without external requests."""

import json
from dataclasses import replace

from researchchain.providers.chatgpt_plan import Completion
from researchchain.research_prompt import PreparedResearch
from researchchain.web_research import WebAction, WebSource

BRIEF_PREFIX = "Follow an analyst lead. Synthetic EquityCats loop fixture."
MATCHED_CLOSE_URL = "https://example.org/synthetic/matched-close"


def timestamp_gap(iteration: int) -> str:
    return f"Which prices were available at a common cutoff for synthetic session {iteration}?"


def matched_close(iteration: int) -> str:
    return (
        "The new comparison matches both instruments at 16:00 Eastern "
        f"for synthetic session {iteration}."
    )


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
    prior_test = matched_close(pass_number - 1)
    instructions = prepared.instructions
    document = json.loads(completion.text)
    web_research = completion.web_research
    if "Use the owner's brief and this pass's test." in instructions:
        conclusion = "Synthetic pricing baseline for rates and equities."
        if pass_number > 1 and timestamp_gap(pass_number - 1) in context:
            conclusion += f" {prior_test}"
    elif "Act as a second analyst." in instructions:
        conclusion = "Synthetic rival explains the move through shared duration exposure."
        if prior_test in context:
            conclusion += (
                f" An independent timing check confirms the prior gap is closed. {prior_test}"
            )
    elif "Review both explanations and verify the decisive evidence" in instructions:
        if (
            ready_on is not None
            and pass_number >= ready_on
            and (ready_on == 1 or prior_test in context)
        ):
            conclusion = "Synthetic audit reproduced the matched-window comparison."
            if prior_test in context:
                conclusion += f" {prior_test}"
                if record_sources and web_research is not None:
                    title = "Synthetic synchronized-close observations"
                    action = WebAction(
                        id="ws_matched_close",
                        action="open_page",
                        status="completed",
                        queries=[],
                        url=MATCHED_CLOSE_URL,
                    )
                    source = WebSource(url=MATCHED_CLOSE_URL, title=title, cited=True)
                    web_research = web_research.model_copy(
                        update={
                            "actions": [*web_research.actions, action],
                            "sources": [*web_research.sources, source],
                        }
                    )
                    conclusion += f" [{title}]({MATCHED_CLOSE_URL})."
            document["revision_summary"] = "ready"
            document["unresolved_questions"] = []
            document["evidence_requests"] = []
        else:
            conclusion = (
                "Synthetic audit found a timestamp gap. The different session closes could explain "
                "the apparent disagreement between rates and equities."
            )
            document["revision_summary"] = "needs_more"
            document["unresolved_questions"] = ["Which market closed first?"]
            document["evidence_requests"] = [
                {
                    "question": timestamp_gap(pass_number),
                    "source_needed": "Synthetic observations with synchronized timestamps.",
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
