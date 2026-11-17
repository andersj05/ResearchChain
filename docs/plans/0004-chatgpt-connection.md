# ChatGPT plan connection

Owner decision, 2026-11-14: use the included ChatGPT Pro allowance for the first
live research workflow. The current official Sign in with ChatGPT flow supports
locally hosted apps without an API key. Do not copy Codex credentials or silently
fall back to paid API billing.

This is the provider-setup step of [issue #6](https://github.com/andersj05/ResearchChain/issues/6).
The remaining hypothesis, evidence challenge, budgets, manifests, and human
baseline criteria stay open.

1. Add a local sign-in command using dynamic registration, PKCE, nonce and verified
   OpenID tokens. Keep account registrations separate, preserve the host identity,
   protect credentials, and serialize token refresh across processes.
2. Add an account-specific model catalog and a small Responses connectivity check.
   Require a completed stream; distinguish quota, permission, and transport errors.
   Respect the preview's unsupported fields and avoid automatic billing fallback.
3. Test authentication failures, refresh/revocation, storage, and stream completion
   with synthetic credentials. Complete the real browser consent and one bounded
   connection check using the owner's plan when available.
4. Run required checks, commit coherent changes frequently, and merge this step
   into dev after CI. Continue issue #6 on a fresh feature branch.

Sources checked 2026-11-14:

- [Local app registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

No API credits are purchased or enabled by this step. A separate eligible Pro API
credit benefit is not the selected authentication or usage path.
