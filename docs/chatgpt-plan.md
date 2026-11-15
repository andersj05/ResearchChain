# Use a ChatGPT plan

ResearchChain's local provider connection supports the official **Sign in with
ChatGPT** flow. Eligible requests use the selected ChatGPT account's plan allowance.
The owner selected this route for the first live research workflow. An API key,
API-credit purchase, and access to Codex's credential files are not needed.

## Connect and check

From the repository root:

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

This step supplies local account setup and connectivity checks. The workflow
runtime remains deterministic until the bounded research nodes in
[issue #6](https://github.com/andersj05/ResearchChain/issues/6) are implemented.
Workflow-level cancellation, iteration/tool budgets, reproducible research
manifests, independent evidence challenge, and the human baseline are still
required. The CLI connection is not application authentication or remote hosting.

Current implementation follows OpenAI's
[local-app sign-in guide](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[account/session guide](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions),
[model/inference guide](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
and [preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
