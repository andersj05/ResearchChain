"""Test-only worker stops at a durable boundary until its parent kills it."""

import argparse
import time
from pathlib import Path
from typing import Any

from researchchain.database import Database
from researchchain.runtime import RunStore
from researchchain.worker import RunWorker


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=["before_claim", "after_claim", "after_command"])
    parser.add_argument("--ready-file", type=Path, required=True)
    args = parser.parse_args()
    database = Database.from_env()
    if not database.schema.startswith("test_") or len(database.schema) != 37:
        raise RuntimeError("Worker process fixture requires an isolated test schema.")
    database.ready()

    def hold() -> None:
        args.ready_file.write_text("ready", encoding="utf-8", newline="\n")
        while True:
            time.sleep(0.1)

    original = RunWorker._claim

    def claim(self: RunWorker, *arguments: Any) -> bool:
        if args.phase == "before_claim":
            hold()
        claimed = original(self, *arguments)
        if claimed and args.phase == "after_claim":
            hold()
        return claimed

    def finish(*arguments: Any) -> None:
        hold()

    if args.phase == "after_command":
        RunWorker._finish = staticmethod(finish)  # type: ignore[method-assign]
    else:
        RunWorker._claim = claim  # type: ignore[method-assign]
    RunWorker(RunStore(database)).run_once()


if __name__ == "__main__":
    main()
