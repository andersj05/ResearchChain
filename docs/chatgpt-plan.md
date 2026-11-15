# Use a ChatGPT plan

ResearchChain's local provider connection supports the official **Sign in with
ChatGPT** flow. Eligible requests use the selected ChatGPT account's plan allowance.
The owner selected this route for the first live research workflow. An API key,
API-credit purchase, and access to Codex's credential files are not needed.

## Connect and check

In a research workflow, open **Run workflow** and find **ChatGPT plan usage**.
Choose **Connect ChatGPT** (or **Reconnect ChatGPT**), then **Open sign-in page**.
On that page, choose **Continue with ChatGPT**, sign in and allow plan usage.
Leave credit use disabled to stay within the included allowance. Return to the
workbench; it reports the result and refreshes the available models automatically.

The consent page lasts ten minutes. Reopening the run dialog or refreshing the
workbench recovers the current link without starting another attempt. **Cancel
sign-in** closes a pending listener and keeps the saved connection. Once exchange
has started, the app finishes verifying the account and reports the actual result.
Expiry or denial also keeps the previous credentials; granting identity without
plan permission instead reports **plan usage is disabled**.

Starting sign-in, checking its progress and refreshing models do not run research.
Credit permission is managed in ChatGPT and is not attested by ResearchChain.

The CLI remains available from the repository root:

```text
pnpm provider:login
pnpm provider:models
pnpm provider:verify --model <slug-from-the-list>
```

The first command opens a short-lived local page. Choose **Continue with ChatGPT**,
sign in, and allow ResearchChain to use the plan. Leave credit use disabled in
OpenAI's consent/settings if you want to stay within included usage. The command
waits up to ten minutes. `--no-browser` prints only the local entry link for a
browser on the same computer; do not share the link or OAuth callback.

The model list comes from the selected account. A listed model is not proof that
inference is available. Verify makes one small request and succeeds only after a
completed response with the expected text. It does not send research, enable tools,
retry automatically, or fall back to another billing route. The connection check
closes the stream at 45 seconds, 2,000 output characters, or 2 MiB received data.
Closing a connection cannot guarantee immediate termination of provider-side work.
The preview does not support `max_output_tokens`, so this is not a token-spend cap.

Manage the app's allowance and credit permission in
[ChatGPT usage settings](https://chatgpt.com/settings/usage). Plan/app limits and
workspace policy can stop a request even after streaming starts. ResearchChain
reports that failure and keeps its billing choice. A separate Pro API-credit offer
is not activated by this connection.

## Saved accounts

```text
pnpm provider:status
pnpm provider:accounts
pnpm provider:login --new
pnpm provider:login --account "Account 1"
pnpm provider:select --account "Account 1"
pnpm provider:logout --account "Account 1"
```

Each registration gets a stable label; accounts/workspaces with the same email
stay separate. Sign-in becomes active only after identity validation. For explicit
plan-permission changes, use `pnpm provider:login --consent`. Signing out clears
local tokens and attempts remote revocation. If revocation cannot be confirmed,
disconnect ResearchChain in ChatGPT Settings. Its registration and this computer's
host identity are retained for the next sign-in.

## Storage and scope

On Windows, credentials are encrypted with current-user DPAPI in
`%LOCALAPPDATA%\ResearchChain\auth\chatgpt.dpapi`. On Linux/macOS the file is
`$XDG_CONFIG_HOME/researchchain/auth/chatgpt.json`, or
`~/.config/researchchain/auth/chatgpt.json`, with owner-only directory/file modes
0700/0600. Do not copy these files into the repository or share them in support
requests. There is no plaintext fallback on Windows.

The server holds tokens; the browser receives only the OAuth redirect and a local
sign-in cookie. PKCE, one-time state, nonce, signature/issuer/audience/expiry checks,
and exact registration checks protect the exchange. A lock serializes credential
updates and rotating refresh tokens across processes. Atomic writes replace the
whole record. Callback query strings and authorization URLs are never logged.

The owner-protected in-app controls support one active sign-in per local API
process. Mutations require the owner session, exact Origin and CSRF token.
Read-only status never starts sign-in, and only a local entry URL is returned to
the workbench. Credentials, authorization hints and callbacks remain out of its
API responses. Failed requests are checked with GET rather than replayed.
Pending attempts are cancelled on service shutdown; after restart, explicitly
start again. Use one CLI or in-app flow at a time. This is a single-process local
feature; it is disabled for remote origins and is not a hosted authentication flow.

The connection CLI supplies additional account setup and connectivity checks.
[Research workflows](hypothesis-research.md) use the selected account through
[durable workers](workers.md), with pinned inputs, budgets, cancellation and human
review checkpoints. The human baseline and strict in-flight spend controls remain
part of [issue #6](https://github.com/andersj05/ResearchChain/issues/6).
Workbench [owner access](owner-access.md) is a separate sign-in.

Current implementation follows OpenAI's
[local-app sign-in guide](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[account/session guide](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions),
[model/inference guide](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
and [preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
