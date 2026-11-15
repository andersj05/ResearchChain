# Current state

Updated 2026-11-15. The owner authorized frequent commits and merging completed
steps into dev after passing checks. No main promotion or public deployment.

The actual repository is C:/Users/jense/Desktop/ResearchChain. The empty
Documents/ChatGPT folder is not the checkout. Use explicit working directories.
The current feature checkout is C:/Users/jense/Desktop/ResearchChain-usage,
branch feat/workspace-request-limits. Inspect GitHub and the newest private delivery
receipt for exact integration status and live service handles.

## Workspace request allowance

[Plan 0016](../plans/0016-workspace-request-limits.md) adds a rolling 24-hour
request allowance shared by runs, worker processes and explicit connection tests.
The initial policy permits 100 admissions, with an editable 1-10,000 range and
a pause control in Operations. This is a local request bound, not a billing cap.

Schema 10 adds immutable policy revisions and admission receipts. Short READ
COMMITTED transactions serialize admissions and policy edits, commit before
model work, and retain the physical execution connection's run/checkpoint locks.
Unknown/failed outcomes do not refund admissions. Cleanup preserves the counter;
verified database backups include both tables. Migration imports existing research
attempts conservatively. Older workers must be stopped before upgrading.

Owner controls use revision checks and never replay an unconfirmed save. Current
usage is read explicitly; dirty settings survive refresh and changed settings
must be reviewed. Per-attempt metadata records the admission policy revision.
See [request allowance](../request-allowance.md) and [ADR 0016](../decisions/0016-workspace-request-allowance.md).
Final validation and integration evidence belong in the feature PR and main
.local/usage-delivery.json.

## Operational alerts

[PR #34](https://github.com/andersj05/ResearchChain/pull/34) merged into dev as
6832edc32d8529e9e7323c1fd8e55e18affb0625. Local checks, PR CI 43728513306 and
dev CI 43729957644 passed: 420 backend and 82 browser tests. Private evidence is
in main .local/alerts-delivery.json.

[Plan 0015](../plans/0015-operational-alerts.md) implements an explicit operator CLI:
setup, check, status, once, watch and test. Nothing starts from the web app or
pnpm dev. Check observes current conditions without a profile or delivery; status
only reads saved state. No research writes, provider credential reads or model
calls are needed.

Conditions cover unavailable database/workbench status, missing consumers, overdue
commands, held recovery, uncertain outcomes and failed observations. Independent
confirmation uses spaced samples. Unknown inputs preserve confirmed incidents.
Profiles are private, immutable and bound to the workspace and canonical origin;
database password rotation does not change the workspace binding.

Persist events, IDs, monotonic sequences and retry deadlines before sending. The
receiver must deduplicate IDs, ignore older sequences and acknowledge duplicates
with 2xx. Recovery follows a pending problem after its acknowledgement. Test
events use sequence zero and cannot acknowledge real incidents. A process-shared
lock serializes each profile across operators.

Verified HTTPS delivery uses only fixed codes, random monitor/event IDs, sequence
and timestamps. Secrets enter through hidden prompts and stay in protected local
profiles; transport errors/destinations are not logged. No real profile, receiver,
notification or background monitor has been enabled during implementation.
Local-only mode retains its latest event. External delivery and dead-host
monitoring still need an actual receiver/watchdog and a reviewed test.

Focused coverage includes real synthetic workspace/worker observations, unchanged
research fingerprints, independent confirmation, unknown inputs, failed/ambiguous
acknowledgements, retry ordering, real process locks, hidden input, redaction,
bounded HTTP and a real local TLS receiver. Verify final local/full CI evidence
through the feature PR and main .local/alerts-delivery.json. No database migration,
public API change or new dependency is introduced.
See [monitoring](../monitoring.md) and [ADR 0015](../decisions/0015-operational-alerts.md).

## Encrypted backup delivery

[PR #33](https://github.com/andersj05/ResearchChain/pull/33) merged into dev as
2ad9eead429842c7cb442914e88285db6386a169. Local pnpm check, PR CI 43721570796 and
dev CI 43722984399 passed with 376 backend and 82 browser tests. The Windows hidden
prompt was checked with a disposable key. Private evidence is in main
.local/encryption-delivery.json and .local/encryption-live-check.json.

db:keygen, db:seal and db:unseal use pinned pyrage 1.4.0 and standard age encryption.
A passphrase-protected portable X25519 identity unlocks recovery; later encryption
needs only its public recipient. Both the manifest and PostgreSQL dump are encrypted.
Full authentication precedes strict tar parsing and dump verification. The existing
trusted-source, new-database restore remains a separate explicit operation.

The owner has not chosen an off-machine destination or real recovery-key handling.
Do not create an owner recovery key, upload private research or claim off-machine
recovery is complete until a chosen copied backup has been successfully restored.
See [encrypted backups](../encrypted-backups.md) and [ADR 0014](../decisions/0014-portable-encrypted-backups.md).

## Live research and access

The live verification after PR #34 preserved all 33 schema-9 table fingerprints
and 12 originals (129,817 bytes), with two connected consumers and an idle queue.
Always fence admissions/check the idle queue before stopping owned services, and
restore the workbench after local browser tests or code upgrades. Consult the
newest private delivery receipt for current process handles and schema state.

The owner completed a fresh ChatGPT sign-in during this step on 2026-11-15.
Plan usage is enabled and eight models were verified without inference. See main
.local/signin-restart-receipt.json. That restart request is complete; do not
restart it again without a new owner request or an actual authentication failure.
Credit permission remains owner-controlled in ChatGPT and is not attested by the app.

[PR #32](https://github.com/andersj05/ResearchChain/pull/32) supplies Connect/Reconnect
under Run workflow → ChatGPT plan usage. Personal consent remains separate from
workbench owner access. The local flow is owner/Origin/CSRF protected and disabled
for remote origins. See [ChatGPT connection](../chatgpt-plan.md) and
[owner access](../owner-access.md).

## Runtime invariants

One configured database/schema is one owner workspace. Keep ExecutionControl.lock
shared with PostgresSaver.lock. Physical connections own run/checkpoint fencing;
never reconnect locked execution transparently. Worker presence uses a separate
connection. Persisted commands survive API restarts; uncertain model calls are not
blindly retried. Credentials, owner sessions and monitor profiles stay outside
research backups.

Retention [PR #31](https://github.com/andersj05/ResearchChain/pull/31) requires a
persisted preview and typed DELETE, protects active/paused/uncertain/referenced
work, rechecks references and leaves retry tombstones. Keep writer locks and
READ COMMITTED enforcement. Never purge private research as a test or rerun old
schema-7/8 upgrade scripts against the live schema-9 database.

Browser tests use disposable e2e_ schemas and synthetic credentials/providers.
Projects run chromium → signin → access → workers → retention. No local browser
suite should displace live services without an idle-queue check and restoration.
Use ignored .local receipts for the newest process handles, not old chat summaries.

## Remaining work

[Issue #9](https://github.com/andersj05/ResearchChain/issues/9) still needs actual
off-machine/PITR recovery, external alert/watchdog setup, operational secret
rotation, provider-side hard spend controls and workload-based hosting choices. Private
uploads, notifications, paid services and deployment need a concrete authorized
destination/configuration; local implementation alone does not enable them.

[Issue #6](https://github.com/andersj05/ResearchChain/issues/6) needs actual owner
review of the paused pilot and stricter spend follow-up. The provider preview
cannot cap an in-flight response. [Issue #7](https://github.com/andersj05/ResearchChain/issues/7)
needs real holdouts, independent labels and judge calibration. Do not fabricate
feedback, approve checkpoints or add inference calls incidentally.

The unreviewed private pilot includes a four-section report, three originals and
a starter style guide. Private identifiers/export are in main .local/report-pilot.json
and .local/pilot-report-review.zip. Its research used 9,765 input and 4,135 output
tokens and remains paused for human review.

Use gh outside the Windows sandbox; sandboxed auth errors do not justify logging
out or in. Write UTF-8 with LF. Never commit .local, secrets, browser state, private
research, exports or transcripts.
