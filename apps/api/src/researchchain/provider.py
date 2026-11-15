"""Local provider setup: uv run --project apps/api python -m researchchain.provider."""

import argparse
import asyncio
import sys
import webbrowser

import httpx

from researchchain.providers.chatgpt_auth import PLAN_SCOPE, ChatGPTAuth, ProviderError
from researchchain.providers.chatgpt_login import browser_login
from researchchain.providers.chatgpt_plan import ChatGPTPlan
from researchchain.providers.credentials import ConnectionError, CredentialStore


def main() -> int:
    parser = argparse.ArgumentParser(description="ResearchChain ChatGPT plan connection")
    parser.add_argument(
        "command", choices=["login", "status", "accounts", "select", "logout", "models", "verify"]
    )
    parser.add_argument("--account", help="Saved account label, for example 'Account 1'")
    parser.add_argument("--new", action="store_true", help="Register another account/workspace")
    parser.add_argument(
        "--consent", action="store_true", help="Explicitly request plan-use permission again"
    )
    parser.add_argument(
        "--no-browser", action="store_true", help="Print a local sign-in link without opening it"
    )
    parser.add_argument("--model", help="Account-specific model slug for the connection check")
    args = parser.parse_args()
    store = CredentialStore()
    try:
        with httpx.Client(timeout=15, follow_redirects=False, trust_env=False) as client:
            auth = ChatGPTAuth(store, client)
            with store.locked():
                saved = store.read()
                account_id = saved.active_client_id
                if args.account:
                    selected = [a for a in saved.accounts.values() if a.label == args.account]
                    if len(selected) != 1:
                        raise ConnectionError(
                            "Account label not found. Run provider:accounts first."
                        )
                    account_id = selected[0].client_id
            if args.command == "login":
                account = browser_login(
                    auth,
                    None if args.new else account_id,
                    new=args.new,
                    consent=args.consent,
                    open_browser=(lambda url: None) if args.no_browser else webbrowser.open,
                )
                print(f"{account.label}: signed in.")
                if not account.tokens or PLAN_SCOPE not in account.tokens.scopes:
                    print("Plan use is disabled. Run provider:login --consent to enable it.")
                    return 1
                print("Using ChatGPT plan. Manage usage: https://chatgpt.com/settings/usage")
            elif args.command in {"status", "accounts"}:
                if not saved.accounts:
                    print("ChatGPT is not connected. Run pnpm provider:login.")
                for account in saved.accounts.values():
                    state = (
                        "signed out"
                        if not account.tokens
                        else (
                            "plan enabled"
                            if PLAN_SCOPE in account.tokens.scopes
                            else "plan disabled"
                        )
                    )
                    active = " (active)" if account.client_id == saved.active_client_id else ""
                    # Email helps the owner distinguish registrations; credentials never print.
                    print(f"{account.label}{active}: {account.email or 'ChatGPT account'}; {state}")
            elif args.command == "select":
                if not args.account or not account_id:
                    raise ConnectionError("Select an account with --account 'Account 1'.")
                with store.locked():
                    current = store.read()
                    account = current.accounts[account_id]
                    if account.tokens is None:
                        raise ConnectionError("Sign in to that saved account before selecting it.")
                    current.active_client_id = account_id
                    store.write(current)
                print(f"{account.label} selected. Refresh the model list for this account.")
            elif args.command == "logout":
                if not account_id:
                    raise ConnectionError("No ChatGPT account is selected.")
                confirmed = auth.sign_out(account_id)
                print("Signed out locally; registration retained for the next sign-in.")
                if not confirmed:
                    print(
                        "Remote revocation was not confirmed. "
                        "Disconnect ResearchChain in ChatGPT Settings."
                    )
            else:
                plan = ChatGPTPlan(auth)
                selected_id, choices = plan.models()
                if args.command == "models":
                    for choice in choices:
                        print(f"{choice.slug}\t{choice.display_name}")
                    return 0
                if not args.model:
                    raise ConnectionError(
                        "Choose a model from provider:models, then verify with --model <slug>."
                    )
                if args.model not in {choice.slug for choice in choices}:
                    raise ConnectionError("That model is not listed for this ChatGPT account.")
                result = asyncio.run(
                    plan.complete(
                        args.model,
                        "Reply with exactly: ResearchChain connected.",
                        account_id=selected_id,
                    )
                )
                if result.text.strip() != "ResearchChain connected.":
                    raise ConnectionError(
                        "Inference completed, but the connection check text did not match."
                    )
                print(f"Verified completed inference with {result.model}. Using ChatGPT plan.")
                usage = result.usage
                print(
                    f"Reported tokens: input={usage.get('input_tokens', 'unknown')}, "
                    f"output={usage.get('output_tokens', 'unknown')}."
                )
                print("Manage usage: https://chatgpt.com/settings/usage")
        return 0
    except (ConnectionError, OSError) as error:
        print(
            str(error) if isinstance(error, ConnectionError) else "Local connection setup failed.",
            file=sys.stderr,
        )
        if isinstance(error, ProviderError):
            print(
                f"HTTP={error.status}; code={error.code}; param={error.param}; "
                f"shape={error.shape}; request_id={error.request_id}",
                file=sys.stderr,
            )
        return 1
    except KeyboardInterrupt:
        print("Connection operation cancelled.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
