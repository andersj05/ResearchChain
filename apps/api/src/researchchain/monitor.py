"""Explicit local monitoring commands; no daemon or external destination starts implicitly."""

import argparse
import getpass
import json
import sys
import time
import warnings
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import NoReturn

from pydantic import SecretStr

from researchchain.access_config import AccessConfig
from researchchain.database import Database
from researchchain.monitor_http import MonitorHTTP
from researchchain.monitor_models import MonitorError, MonitorSettings
from researchchain.monitor_probe import collect_observation, utcnow
from researchchain.monitor_service import Monitor
from researchchain.monitor_store import MonitorStore


class Parser(argparse.ArgumentParser):
    def error(self, message: str) -> NoReturn:
        # A mistakenly pasted secret must not be repeated in an argparse error.
        self.exit(2, "Invalid monitor command or option. Run pnpm monitor --help.\n")


def hidden(prompt: str) -> str:
    if not sys.stdin.isatty():
        raise MonitorError("Configure delivery in a local terminal with hidden input.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            return getpass.getpass(prompt).strip()
    except (getpass.GetPassWarning, EOFError):
        raise MonitorError("Hidden input is unavailable; no profile was created.") from None


def settings_for(database: Database, args: argparse.Namespace) -> MonitorSettings:
    binding = AccessConfig.from_env(database)
    return MonitorSettings(
        workspace_id=binding.workspace_id,
        origin=binding.origin,
        minimum_workers=args.minimum_workers,
        pending_seconds=args.pending_seconds,
        interval_seconds=getattr(args, "interval_seconds", 60),
        confirmations=getattr(args, "confirmations", 2),
    )


def exit_status(report: dict[str, object]) -> int:
    if report["delivery_failed"]:
        return 2
    return 1 if report["active"] else 0


def main(
    argv: list[str] | None = None,
    *,
    database: Database | None = None,
    http: MonitorHTTP | None = None,
    clock: Callable[[], datetime] = utcnow,
) -> int:
    parser = Parser(description="Content-free local operational checks and explicit alerts")
    commands = parser.add_subparsers(dest="command", required=True, parser_class=Parser)
    setup = commands.add_parser("setup", help="Create a NEW private, workspace-bound profile")
    setup.add_argument("--profile", type=Path, required=True)
    setup.add_argument(
        "--local-only",
        action="store_true",
        help="Record local transitions without external delivery",
    )
    setup.add_argument("--interval-seconds", type=int, default=60)
    setup.add_argument("--confirmations", type=int, default=2)
    check = commands.add_parser(
        "check", help="Check current conditions without profile or delivery"
    )
    for command in (setup, check):
        command.add_argument("--minimum-workers", type=int, default=1)
        command.add_argument("--pending-seconds", type=int, default=900)
    for name, help_text in (
        ("status", "Read saved monitor state without probing or delivering"),
        ("once", "Sample once if due and attempt pending delivery if due"),
        ("watch", "Run in this terminal until interrupted; no service is installed"),
        ("test", "Explicitly send a fixed test event to the configured destination"),
    ):
        command = commands.add_parser(name, help=help_text)
        command.add_argument("--profile", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        selected = database or Database.from_env()
        transport = http or MonitorHTTP()
        if args.command == "check":
            observation = collect_observation(
                selected, settings_for(selected, args), transport, clock
            )
            print(observation.model_dump_json())
            return 1 if any(value is True for value in observation.checks.values()) else 0
        store = MonitorStore(args.profile)
        if args.command == "setup":
            config = settings_for(selected, args)
            if not args.local_only:
                url = hidden("Webhook HTTPS URL (hidden; empty for local alerts): ")
                token = hidden("Bearer token (hidden; optional): ") if url else ""
                # Validate again after hidden input; model_copy would bypass validators.
                config = MonitorSettings.model_validate(
                    {
                        **config.model_dump(),
                        "webhook": SecretStr(url) if url else None,
                        "bearer": SecretStr(token) if token else None,
                    }
                )
            store.create(config)
            print(
                json.dumps(
                    {
                        "status": "configured",
                        "monitor_id": str(config.id),
                        "external_delivery_configured": config.webhook is not None,
                        "monitor_started": False,
                    }
                )
            )
            return 0
        monitor = Monitor(selected, store, http=transport, clock=clock)
        if args.command == "status":
            result = monitor.status()
            print(json.dumps(result))
            return exit_status(result)
        if args.command == "test":
            delivery = monitor.test_delivery()
            print(json.dumps({"test_delivery": "acknowledged" if delivery.accepted else "failed"}))
            return 0 if delivery.accepted else 2
        while True:
            result = monitor.once()
            print(json.dumps(result), flush=True)
            if args.command == "once":
                return exit_status(result)
            # Delay starts after the previous cycle; slow checks never cause a burst.
            interval = result["interval_seconds"]
            assert isinstance(interval, int)
            time.sleep(interval)
    except KeyboardInterrupt:
        print(json.dumps({"status": "stopped"}))
        return 130
    except MonitorError as error:
        print(json.dumps({"status": "unavailable", "message": str(error)}), file=sys.stderr)
    except Exception:
        print(
            json.dumps(
                {
                    "status": "unavailable",
                    "message": (
                        "Monitor operation failed. Check its private profile and configuration."
                    ),
                }
            ),
            file=sys.stderr,
        )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
