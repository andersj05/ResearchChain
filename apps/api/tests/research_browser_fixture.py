"""Browser-only provider fixture, restricted to an isolated browser-test schema."""

import asyncio
import json
import os
from dataclasses import replace
from pathlib import Path
from typing import Any

from discovery_fixture import DiscoveryProvider
from equitycats_fixture import equitycats_completion
from session_browser_fixture import BrowserTeam
from swarm_browser_fixture import swarm_completion, swarm_models
from test_provider_signin import BrowserHarness
from test_web_research import WebProvider

from researchchain.main import create_app
from researchchain.providers.chatgpt_plan import Completion

if not os.environ.get("DATABASE_SCHEMA", "").startswith("e2e_"):
    raise RuntimeError("The synthetic provider requires an isolated e2e database.")


class BrowserProvider(WebProvider):
    def __init__(self):
        super().__init__()
        self.team = BrowserTeam()
        self.discovery = DiscoveryProvider()

    def status(self):
        catalog = super().status()
        catalog.models.extend(swarm_models())
        return catalog

    async def complete(self, manifest: Any, prepared: Any, on_delta: Any) -> Completion:
        if (
            manifest.tool_config.get("discovery_version")
            and "proposals" in prepared.schema["properties"]
        ):
            return await self.discovery.complete(manifest, prepared, on_delta)
        swarm_response = await swarm_completion(prepared, on_delta)
        if swarm_response is not None:
            return swarm_response
        team_response = await self.team.complete_study(manifest, prepared, on_delta)
        if team_response is not None:
            return team_response
        if manifest.tool_config.get("discovery_version"):
            return await self.discovery.complete(manifest, prepared, on_delta)
        on_delta('{"schema_version":')
        if "Wait for cancellation" in str(prepared.input_items):
            await asyncio.sleep(60)
        else:
            await asyncio.sleep(1.5)
        result = await super().complete(manifest, prepared, on_delta)
        if prepared.web_search and "Inspect Markdown output" in str(prepared.input_items):
            document = json.loads(result.text)
            document["conclusion"] = (
                "## Research memo\n\n**Observations**\n\n"
                "1. Read the [Reference](https://example.org/data).\n"
                "2. Compare the [unrecorded source](https://unrecorded.invalid/data).\n\n"
                "| Period | Quantity |\n| --- | ---: |\n| Q1 | 17 |\n\n"
                "> Keep dates attached to estimates.\n\n"
                "```text\nperiod,quantity\nQ1,17\n```\n\n"
                "![External chart](https://unrecorded.invalid/chart.png)\n\n"
                "<button>Model control</button>"
            )
            return replace(result, text=json.dumps(document))
        return equitycats_completion(prepared, result)


# The real loopback flow uses fake OAuth and a disposable credential store.
signin = BrowserHarness(Path(os.environ["RESEARCHCHAIN_ACCESS_DIRECTORY"]) / "chatgpt-test")
app = create_app(provider=BrowserProvider(), signin=signin.service)


if __name__ == "__main__":
    from researchchain.database import Database
    from researchchain.runtime import RunStore
    from researchchain.worker import main

    raise SystemExit(main(runs=RunStore(Database.from_env(), BrowserProvider())))
