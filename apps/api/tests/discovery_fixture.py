"""Deterministic replies for the isolated source-led desk rehearsals."""

import json
from dataclasses import replace

from swarm_browser_fixture import result as swarm_reply
from test_research_sessions import SessionProvider


def discovery_assignment(sentence):
    if "debt" in sentence:
        return {
            "title": "Compare refinancing groups",
            "objective": "Group firms by debt due within twelve months. Compare weekly returns "
            "within each sector. A flat spread would weaken the proposed financing explanation.",
        }
    return {
        "title": "Rebuild participation",
        "objective": "Compare equal-weight and index-weight returns for the same constituents and "
        "dates. Check whether most industries participated.",
    }


class DiscoveryProvider(SessionProvider):
    async def complete(self, manifest, prepared, on_delta):
        reply = await super().complete(manifest, prepared, on_delta)
        packet = json.loads(prepared.input_items[0]["content"][0]["text"])
        properties = prepared.schema["properties"]
        if "proposals" in properties:
            citations = [
                {
                    "evidence_id": source["id"],
                    "relation": "context",
                    "basis": source["citation_basis"],
                    "locator": source["title"],
                    "quote": source["text"][:80],
                    "rationale": {
                        "image": "The index rose. Its weighting matters for this comparison.",
                        "discussion": "This describes the speaker's coverage on Friday.",
                        "text": "This records the owner's expectation before the rally.",
                    }.get(source["kind"], "Check the source's coverage and timing."),
                }
                for source in packet["sources"]
                if source["citation_basis"] != "metadata_only"
            ]
            proposal = {
                "sentence": "The rally may have been concentrated in larger constituents.",
                "alternative": "Participation may have differed by sector.",
                "first_check": "Compare equal-weight and index-weight returns.",
                "weaken_if": "Equal weights show the same gain across sectors.",
                "evidence_ids": [c["evidence_id"] for c in citations],
            }
            reading = {
                "observation": "The desk saw a flat median stock. How far did the rally reach?"
                if citations
                else "Only a reference is available for the lead to read.",
                "question": "Which firms did you expect to participate?",
                "citations": citations,
                "proposals": [proposal] if citations else [],
            }
            return replace(reply, text=json.dumps(reading))
        if "assignments" in properties:
            plan = {
                "assignments": [discovery_assignment(packet["human_feedback"])],
                "review_question": None,
            }
            return replace(reply, text=json.dumps(plan))
        if "leads" in properties:
            return swarm_reply(
                prepared.model,
                answer={
                    "leads": [
                        {
                            "title": f"Lead {index}",
                            "objective": f"Test interpretation {index} of the study material.",
                        }
                        for index in range(1, properties["leads"]["minItems"] + 1)
                    ]
                },
            )
        if prepared.analyst_options and prepared.analyst_options["tool_choice"] == "required":
            lead_state = json.loads(prepared.input_items[1]["content"][0]["text"])["swarm_lead"]
            if lead_state["lead_index"] == 1 and lead_state["turn"] == 1:
                return swarm_reply(
                    prepared.model,
                    tool="delegate",
                    arguments={
                        "rationale": "Test the owner's working sentence directly.",
                        "assignments": [discovery_assignment(packet["human_feedback"])],
                    },
                )
            tools = prepared.analyst_options["tools"][0]["tools"]
            if not any(tool["name"] == "finish" for tool in tools):
                return swarm_reply(
                    prepared.model,
                    tool="ask_expert",
                    arguments={
                        "thesis": "Differences between sectors may explain the weekly move.",
                        "question": "Which comparison would distinguish concentration from a sector effect?",
                        "options": [],
                    },
                )
            return swarm_reply(
                prepared.model,
                tool="finish",
                arguments={
                    "findings": "The synthetic evidence only supports this test.",
                    "limitations": ["Synthetic fixture."],
                },
            )
        return reply
