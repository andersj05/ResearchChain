"""Browser-only provider fixture, restricted to an isolated browser-test schema."""

import asyncio
import os
from pathlib import Path
from typing import Any

from test_provider_signin import BrowserHarness
from test_research_runtime import FakeProvider

from researchchain.main import create_app
from researchchain.providers.chatgpt_plan import Completion

if not os.environ.get("DATABASE_SCHEMA", "").startswith("e2e_"):
    raise RuntimeError("The synthetic provider requires an isolated e2e database.")


class BrowserProvider(FakeProvider):
    async def complete(self, manifest: Any, prepared: Any, on_delta: Any) -> Completion:
        on_delta('{"schema_version":')
        if "Wait for cancellation" in str(prepared.input_items):
            await asyncio.sleep(60)
        else:
            await asyncio.sleep(1.5)
        return await super().complete(manifest, prepared, on_delta)


# The real loopback flow uses fake OAuth and a disposable credential store.
signin = BrowserHarness(Path(os.environ["RESEARCHCHAIN_ACCESS_DIRECTORY"]) / "chatgpt-test")
app = create_app(provider=BrowserProvider(), signin=signin.service)


if __name__ == "__main__":
    from researchchain.database import Database
    from researchchain.runtime import RunStore
    from researchchain.worker import main

    raise SystemExit(main(runs=RunStore(Database.from_env(), BrowserProvider())))
