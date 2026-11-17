# In-app ChatGPT sign-in

Related: [research workflow #6](https://github.com/andersj05/ResearchChain/issues/6).
Base: dev 17239c9, after retention PR #31.

## Outcome

The owner starts or reopens a ten-minute ChatGPT consent flow from the research
connection panel, sees its progress, and refreshes models when it succeeds.
The existing plan connection remains available until a validated replacement.
Credit permissions remain under the owner's control in ChatGPT.

## Implementation

- Reuse the official loopback callback, PKCE, browser binding, validated identity
  and encrypted credential store. Never expose OAuth hints or tokens to the app.
- Add owner/Origin/CSRF-protected start and cancel endpoints, plus read-only status.
  Keep one active flow per local API process; repeated starts reuse it. GET never
  starts sign-in. Shutdown cancels pending work; restart requires an explicit click.
- Make cancellation distinct from completion: once code exchange begins, finish
  and report its actual result. Bound the listener lifetime and clear expired URLs.
- Show a normal link to open the consent page, so popup blocking cannot lose it.
  Refresh and reopening the panel recover status without replaying a mutation.
- Disable this local flow for remote origins and injected test providers unless a
  synthetic sign-in service is supplied. Do not support public/multi-process hosting.

## Verification and delivery

Test callback success/denial/expiry/cancellation, concurrent starts, shutdown,
safe error output, existing-connection preservation, and API access/CSRF checks.
Browser tests use isolated synthetic credentials and provider responses, including
mobile layout, reopening a pending flow and failures. Run pnpm check, production
browser checks, and exact-head CI before merging to dev. No private inference,
billing changes, private cleanup or public deployment.

## Prior milestone verified

Retention PR #31 merged as 17239c92fc6f8f92172a3eeec706de2c793bacca.
Final PR CI 43713259461 and post-merge CI 43714066844 passed (336 backend,
77 browser tests). Private delivery receipts confirm schema 9 and unchanged
research/original content. The saved Pro connection remains enabled.
