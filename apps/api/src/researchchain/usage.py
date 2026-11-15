"""Local operator controls for the current workspace request allowance."""

import argparse
import sys
from typing import NoReturn

from pydantic import ValidationError

from researchchain.database import Database
from researchchain.usage_models import UsageError, UsagePolicyUpdate
from researchchain.usage_store import UsageStore


class Parser(argparse.ArgumentParser):
    def error(self, message: str) -> NoReturn:
        self.exit(2, "Invalid request-allowance arguments. Use --help.\n")


def main() -> int:
    parser = Parser(description="ResearchChain workspace model request allowance")
    commands = parser.add_subparsers(dest="command", required=True, parser_class=Parser)
    commands.add_parser("status", help="Read the current policy and rolling 24-hour count")
    configure = commands.add_parser("configure", help="Explicitly save a new policy")
    configure.add_argument("--expected-revision", type=int, required=True)
    configure.add_argument("--max-requests", type=int, required=True)
    state = configure.add_mutually_exclusive_group(required=True)
    state.add_argument("--pause", action="store_true")
    state.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    try:
        store = UsageStore(Database.from_env())
        result = (
            store.snapshot()
            if args.command == "status"
            else store.configure(
                UsagePolicyUpdate(
                    expected_revision=args.expected_revision,
                    max_requests_24h=args.max_requests,
                    paused=args.pause,
                ),
                "operator",
            )
        )
        print(result.model_dump_json(indent=2))
        return 0
    except UsageError as error:
        print(str(error), file=sys.stderr)
        return 2
    except (ValidationError, ValueError):
        print("Invalid request limits or workspace configuration.", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print(
            "Request-allowance operation interrupted. Read status before retrying.", file=sys.stderr
        )
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
