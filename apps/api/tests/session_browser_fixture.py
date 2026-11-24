"""Let the browser inspect two admitted team requests before replying with synthetic work."""

import asyncio
import json
import os
from dataclasses import replace
from pathlib import Path
from uuid import UUID

from test_research_team import TeamProvider

BRIEF = "Compare synthetic demand and inventories and illustrate the result.\nBrowser study "


class BrowserTeam(TeamProvider):
    def __init__(self):
        super().__init__(workspaces=True)

    async def complete_study(self, manifest, prepared, on_delta):
        packet = json.loads(prepared.input_items[0]["content"][0]["text"])
        if not packet["brief"].startswith(BRIEF):
            return None
        study = UUID(packet["brief"][len(BRIEF) :])
        properties = prepared.schema["properties"]
        member = "assignments" not in properties and "review_question" in properties
        receipts = any(i.get("type") == "function_call_output" for i in prepared.input_items)
        if member and not receipts:
            # API, browser and worker use separate processes. The unique marker lives in
            # the browser runner's temporary directory and is released in the test's finally.
            marker = Path(os.environ["RESEARCHCHAIN_ACCESS_DIRECTORY"]) / f"observed-{study}"
            async with asyncio.timeout(90):
                while not marker.is_file():
                    await asyncio.sleep(0.1)
        response = await super().complete(manifest, prepared, on_delta)
        if member or receipts or "assignments" in properties:
            return response
        # Exercise the editor's real saved feedback in the actual generated Markdown.
        call = response.analyst_response["output"][0]
        args = json.loads(call["arguments"])
        guidance = "".join(
            "\n\nTeam direction: " + item["text"] for item in packet.get("owner_directions", [])
        )
        feedback = guidance + "\n\nOwner direction: " + packet["human_feedback"]
        args["script"] += (
            "with Path('outputs/report.md').open('a', encoding='utf-8') as report_file:\n"
            f"    report_file.write({feedback!r})\n"
        )
        return replace(
            response,
            analyst_response={
                **response.analyst_response,
                "output": [{**call, "arguments": json.dumps(args)}],
            },
        )
