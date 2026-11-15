# Current state

Updated 2026-11-15. The owner authorized frequent commits and merging completed
steps into dev after passing checks. No main promotion or public deployment.

The actual repository is C:\Users\jense\Desktop\ResearchChain. The empty
Documents/ChatGPT folder is not the checkout. Use explicit working directories.
The current feature checkout is C:\Users\jense\Desktop\ResearchChain-signin,
branch feat/in-app-chatgpt-signin.

## ChatGPT sign-in

The latest personally completed sign-in succeeded at approximately 13:03 UTC on
2026-11-15. The saved connection has plan usage enabled and exposes eight models.
Verification made no inference request. Private evidence is the main checkout's
.local/signin-restart-receipt.json. Credit permission remains controlled by the
owner in ChatGPT and is not attested by ResearchChain. Do not restart a working
connection unless requested or authentication actually fails.

[PR #32](https://github.com/andersj05/ResearchChain/pull/32) adds Connect/Reconnect
ChatGPT to Run workflow → ChatGPT plan usage. The owner opens a ten-minute local
consent page, can reopen it after refresh or cancel pending sign-in, and sees the
result. Success refreshes models. Repeated starts share the current listener;
GET never starts authentication or replays a failed mutation.

Owner sessions, exact Origin and CSRF protect the controls. The existing PKCE,
browser-bound callback, identity checks and encrypted credential store remain.
Cancellation before exchange preserves the saved connection; after exchange starts,
the app reports its actual result. Denial and expiry retain prior credentials.
A valid identity without plan scopes is reported as disabled. Pending listeners
close on shutdown. The flow is local and single-process; remote origins disable it.
Use one CLI or in-app attempt at a time. No database migration was added.

Focused synthetic provider/API checks passed, as did the five new production
browser scenarios (desktop/mobile, lost response, refresh, cancellation, denial,
and expiry/status recovery). Complete checks and final screenshots are under
validation; verify the exact PR head before integration. The final delivery receipt
belongs in main .local/signin-delivery.json. Feature logs live in .local/signin-check.log,
.local/signin-browser-check.log and .local/signin-browser-retry.log.
See [the connection guide](../chatgpt-plan.md) and [plan 0013](../plans/0013-in-app-chatgpt-signin.md).

## Established operations and runtime

Retention [PR #31](https://github.com/andersj05/ResearchChain/pull/31) merged into dev
as 17239c92fc6f8f92172a3eeec706de2c793bacca. Final PR CI 43713259461 and dev CI
43714066844 passed: 336 backend and 77 browser tests. Schema 9 is live; all 28
existing research/checkpoint table fingerprints and 12 originals (129,817 bytes)
were preserved. Read-only validation left all four retention tables empty.
Private receipts: .local/retention-delivery.json, .local/retention-live-upgrade.json,
.local/retention-live-check.json and .local/retention-upgrade-rehearsal.json.

Run cleanup requires a persisted preview and typed DELETE. It protects active,
paused, uncertain and referenced runs, preserves evidence/reports/evaluations and
deletes only selected unreferenced originals. Tombstones reject stale resurrection;
writer locks, READ COMMITTED enforcement and bounded transactions prevent stale
snapshot races. Never purge private research as a test. See [retention](../retention.md).
Do not rerun old schema-7/8 upgrade scripts against the live schema-9 database.

Operations #30, workers #29, owner access #28, verified backups #27, reports #26,
evaluations #25, bounded research #24, plan connection #23, evidence #22 and
editor/runtime #20–21 are merged. Use linked guides and GitHub for their contracts.

Keep ExecutionControl.lock shared with PostgresSaver.lock. Physical run connections
own execution/checkpoint fencing; never reconnect locked execution transparently.
Worker presence uses a separate connection. Durable HTTP 202 commands feed two
local worker slots; interrupted/uncertain calls are not blindly retried.
One configured database/schema is one owner workspace. Owner browser sign-in and
ChatGPT consent are separate. Credentials and owner access state are outside
research backups. Never log tokens, callback URLs or private research.

Browser tests use disposable e2e_ schemas and synthetic providers/credential stores.
Projects run chromium → signin → access → workers → retention. Only stop owned
live services after confirming the queue is idle when local tests need ports
3000/8000, then restore them. Use the newest private receipt for session handles.

## Remaining work

[Issue #9](https://github.com/andersj05/ResearchChain/issues/9) still covers external
alerting, off-machine/PITR recovery, secret operations, strict usage controls and
workload-based hosting choices. Private uploads, paid services and deployment
need a concrete authorized destination/configuration.

[Issue #6](https://github.com/andersj05/ResearchChain/issues/6) needs actual owner
review of the paused pilot and stricter spend follow-up. The provider preview cannot
cap an in-flight response. [Issue #7](https://github.com/andersj05/ResearchChain/issues/7)
needs real holdouts, independent labels and judge calibration. Never fabricate
feedback, approve checkpoints or add inference calls incidentally.

The unreviewed private pilot has a four-section report, three original sources and
an unreviewed starter style guide. Private identifiers/export are in main
.local/report-pilot.json and .local/pilot-report-review.zip. The original research
pilot used 9,765 input and 4,135 output tokens and remains paused for human review.

GitHub uses gh outside the Windows sandbox. Sandboxed authentication errors do
not justify logout/login. Write UTF-8 with LF newlines. Never commit .local/,
credentials, browser state, private research, exports or transcripts.
