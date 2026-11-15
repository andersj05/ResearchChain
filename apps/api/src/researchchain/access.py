"""Local owner enrollment/recovery; never print a password, token or sign-in URL."""

import argparse
import html
import os
import sys
import webbrowser
from pathlib import Path

from researchchain.access_config import AccessConfig
from researchchain.access_models import AccessError
from researchchain.access_service import AccessService
from researchchain.backup_files import private_directory
from researchchain.database import Database


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ResearchChain owner access")
    parser.add_argument("command", choices=["login", "status", "revoke"])
    parser.add_argument("--owner-name", help="Display name for this workspace's owner")
    parser.add_argument(
        "--write-link",
        type=Path,
        help="Write the sign-in link into a NEW private directory instead of opening a browser",
    )
    args = parser.parse_args(argv)
    try:
        access = AccessService(AccessConfig.from_env(Database.from_env()))
        if args.command == "login":
            code = access.issue_link(args.owner_name)
            url = access.config.origin + "/#owner-link=" + code.get_secret_value()
            if args.write_link:
                private_directory(args.write_link)
                path = args.write_link / "sign-in.html"
                with path.open("x", encoding="utf-8") as output:
                    if os.name != "nt":
                        path.chmod(0o600)
                    output.write(
                        '<!doctype html><meta charset="utf-8">'
                        '<meta name="referrer" content="no-referrer">'
                        "<title>ResearchChain owner sign-in</title>"
                        "<p>This private owner link expires in five minutes and works once.</p>"
                        f'<a rel="noreferrer" href="{html.escape(url, quote=True)}">'
                        "Open ResearchChain</a>"
                    )
                print("Owner sign-in file created in the chosen private directory.")
            else:
                if not webbrowser.open(url, new=2):
                    raise AccessError(
                        "The browser could not open. "
                        "Use --write-link with a new private directory.",
                        503,
                    )
                print("Owner sign-in opened in your browser.")
            print("The link expires in five minutes and can be used once. Do not share it.")
        elif args.command == "revoke":
            access.revoke(all_sessions=True)
            print("All owner sessions and pending links were revoked. The password is unchanged.")
        else:
            with access.store.locked():
                state = access.store.read()
                if state:
                    access.prune(state, access.now())
                print("Owner access configured." if state else "Owner setup is required.")
                print(f"Password enabled: {bool(state and state.password_hash)}")
                print(f"Active sessions: {len(state.sessions) if state else 0}")
        return 0
    except AccessError as error:
        print(str(error), file=sys.stderr)
    except Exception:
        print(
            "Owner access could not be completed. Check configuration and protected storage.",
            file=sys.stderr,
        )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
