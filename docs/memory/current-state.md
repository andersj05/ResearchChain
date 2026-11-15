# Current state

Updated 2026-11-15. The owner authorized frequent commits and merging completed
steps into dev after passing checks. No main promotion or public deployment.

The actual repository is C:\Users\jense\Desktop\ResearchChain. The empty
Documents/ChatGPT folder is not the checkout. Use explicit working directories.
The current feature checkout is C:\Users\jense\Desktop\ResearchChain-encrypted,
branch feat/encrypted-backups.

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

PR #32 merged into dev as 258e736e1bebe353d8e11055e5af77ffcf19c238.
Local checks, exact-head CI 43717211834 and dev CI 43718324056 passed:
352 backend and 82 browser tests. The live schema-9 verification preserved all
33 table fingerprints and 12 originals (129,817 bytes), with two workers and
an idle queue. No inference was made. Main .local/signin-delivery.json holds the
delivery evidence; the latest sign-in attempt is recorded separately.
See [the connection guide](../chatgpt-plan.md).

## Portable encrypted backups

The next issue-9 slice implements db:keygen, db:seal and db:unseal using pinned
pyrage 1.4.0 and standard age encryption. An encrypted portable X25519 identity
uses a hidden, confirmed passphrase; later backup encryption needs only its public
recipient. Both the manifest and PostgreSQL dump are encrypted.

Recovery authenticates the complete stream before parsing exactly two ordinary
tar members. It verifies sizes and the dump hash, then leaves the existing
trusted-source, new-database restore as a separate explicit step. Exclusive file
creation and ownership-tracked cleanup preserve unrelated files. Hard termination
can leave private staging; no secure erase or automatic source deletion is claimed.

All 24 focused synthetic checks passed, including a real PostgreSQL backup,
encrypted round-trip, restore to a new database, original-byte verification,
wrong keys, tampering, malicious archives, write failure, collisions and interrupt
cleanup. Full-check and exact-head CI evidence belong in the feature PR and main
.local/encryption-delivery.json when delivered. No schema/API migration or model
call is part of this change. See [the recovery guide](../encrypted-backups.md),
[ADR 0014](../decisions/0014-portable-encrypted-backups.md) and
[plan 0014](../plans/0014-encrypted-backups.md).

The owner has not selected an off-machine destination. Do not create a real owner
recovery key, upload private research, or claim off-machine recovery is complete
until key handling, the destination and a successful copied-backup recovery are
concrete. Test keys and test research are disposable.

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
