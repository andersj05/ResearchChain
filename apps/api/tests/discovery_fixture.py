"""Deterministic replies for the isolated source-led desk rehearsals."""

import json
from dataclasses import replace

from test_research_sessions import SessionProvider


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
                        "image": "The index rose over the week. Its weighting matters for this comparison.",
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
                "observation": "The desk described the median stock as flat. How broadly did the rally reach?",
                "question": "Which firms did you expect to participate?",
                "citations": citations,
                "proposals": [proposal] if citations else [],
            }
            return replace(reply, text=json.dumps(reading))
        if "assignments" in properties:
            sentence = packet["human_feedback"]
            if "debt" in sentence:
                title = "Compare refinancing groups"
                objective = (
                    "Group firms by debt due within twelve months. Compare weekly returns within "
                    "each sector. A flat spread would weaken the proposed financing explanation."
                )
            else:
                title = "Rebuild participation"
                objective = (
                    "Compare equal-weight and index-weight returns for the same constituents and "
                    "dates. Check whether most industries participated."
                )
            plan = {
                "assignments": [{"title": title, "objective": objective}],
                "review_question": None,
            }
            return replace(reply, text=json.dumps(plan))
        return reply
