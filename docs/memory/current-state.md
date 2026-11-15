# Current state

Updated 2026-11-15. Confirmed retention is implemented in
[PR #31](https://github.com/andersj05/ResearchChain/pull/31), branch
feat/retention-controls. The owner authorized frequent commits and merging each
completed step into dev after CI. No main promotion or public deployment.

The actual repository is C:\Users\jense\Desktop\ResearchChain.
The retention checkout is C:\Users\jense\Desktop\ResearchChain-retention.
The old Documents/ChatGPT folder is empty. Use explicit working directories.

## Confirmed retention

Operations → Run cleanup previews up to ten terminal runs by creation cutoff.
The owner reviews exact IDs, dates, states and original counts, then types DELETE.
Previews expire after fifteen minutes; transactions have a thirty-second deadline.
Confirmation rechecks the entire selection atomically. Lost-response retries return
the immutable receipt; refreshing only reads the result and never repeats deletion.

Cleanup covers commands/jobs, decisions, node executions, controls, research
attempts/manifests, run-evidence links and LangGraph checkpoints/blobs/writes.
Only associated originals with no remaining references are deleted. Evidence,
reports, evaluations, workflow revisions, unrelated uploads, exports and backups
remain. Shared original references are followed transitively, including addresses
inside binary checkpoints. Active/pending work, paused review, uncertain attempts,
busy readers and run references remain protected.

Statement-level shared writer locks coordinate with cleanup's admission,
exclusive-retention and nonblocking run locks. Stale JSON references are rejected.
Run tombstones permanently prevent retry resurrection before provider selection.
A real upload of identical original bytes may recreate its address. Immutable
updates remain forbidden; selected immutable deletes use a schema-bound,
transaction-local allowlist. Snapshot-isolated writes are rejected because their
old snapshots can miss new tombstones; read-only backup snapshots still work.

Migration 0009 adds four metadata tables, functions and writer guards. It does
not delete research. Upstream checkpoint tables are initialized before application
migrations so fresh and upgraded schemas receive the same guards.
See [the guide](../retention.md), [ADR 0013](../decisions/0013-confirmed-retention.md)
and [plan 0012](../plans/0012-retention-controls.md).

## Verified validation and integration evidence

Local pnpm check passed: 336 backend tests in 807.48 seconds, formatting, lint,
strict Python/TypeScript and production build. PR CI 43711632885 passed on 6d0c7da
with 336 backend tests and all 77 production browser tests. A later screenshot
harness correction passed both production layout cases with retries disabled,
including ten selected runs. Desktop/mobile images were inspected. Final CI must
pass on the final commit before merge.

A clean schema-8 backup and verified restore preceded a schema-9 rehearsal on a
new private database. All 28 existing research/checkpoint tables retained exact row
fingerprints; the migration ledger advanced, four retention tables were empty,
and all 12 originals (129,817 bytes) were preserved. The live source was unchanged.
No private purge, provider inference or paid API fallback was used.

Use the latest private receipts and GitHub state before assuming integration:

- Main .local/retention-upgrade-rehearsal.json records the verified archive,
  restored target and exact migration checksum.
- Main .local/retention-baseline.json preserves the pre-upgrade source inventory.
- Main .local/retention-live-upgrade.json, .local/retention-live-check.json and
  .local/retention-delivery.json record the live upgrade and final delivery when
  present. The live upgrade script requires an unchanged source and stopped workers.
- Feature .local/retention-check.log, .local/retention-layout-check.log and
  .local/retention-pr-ci.log hold local/CI validation. Browser captures are synthetic.

The live source began this milestone on schema 8. Do not start schema-9 code
against it before the verified upgrade. Do not rerun the older worker-upgrade
script; it expects schema 7. Never purge private data as an implementation test.

## ChatGPT and owner access

The owner chose included ChatGPT Pro usage through official local-app sign-in,
with no paid API fallback. The latest requested sign-in restart opened a new page
but expired after ten minutes. The saved connection remained active with plan
usage enabled. Credit permission is controlled by the owner in ChatGPT and is not
attested by the app. Recheck provider:status or the protected capability endpoint
without inference. Restart sign-in only when newly requested or authentication fails.

Workbench owner access is separate. pnpm access:login issues a five-minute,
single-use local enrollment/recovery link. Sessions expire after thirty idle
minutes or twelve hours; mutations require exact Origin and session-bound CSRF.
One configured database/schema is one owner workspace. Credentials and owner state
are outside research backups. Do not log tokens, callback URLs or private content.

## Established milestones and runtime constraints

- [Operations #30](https://github.com/andersj05/ResearchChain/pull/30) merged as
  acd22c1, with passing PR/dev CI (314 backend, 71 browser tests). Aggregate status
  requires owner access and never invokes a provider. The live comparison preserved
  all 29 table fingerprints. Private evidence is .local/operations-delivery.json.
- [Workers #29](https://github.com/andersj05/ResearchChain/pull/29) merged as
  1d143c8. HTTP 202 command receipts feed independent durable workers. Defaults are
  two parallel commands and 100 pending. Restored/uncertain work is held rather than
  blindly resent; execution_pending keeps final progress visible. See [workers](../workers.md).
- [Owner access #28](https://github.com/andersj05/ResearchChain/pull/28) merged as
  e7ee33e. Drafts are scoped to owner/workspace and survive same-owner reauthentication;
  rejected mutations are never replayed automatically. See [owner access](../owner-access.md).
- [Backups #27](https://github.com/andersj05/ResearchChain/pull/27) verify original
  hashes, table/schema fingerprints and migration compatibility in a new database.
  Failed restore targets are quarantined. See [backups](../backups.md).
- [Reports #26](https://github.com/andersj05/ResearchChain/pull/26), evaluations #25,
  research #24, connection #23, evidence #22 and editor/runtime #20–21 are merged.
  Reports are immutable revisions with explicit human feedback, pinned sources and
  offline exports. Evaluation references remain outside generation inputs.

Keep ExecutionControl.lock shared with PostgresSaver.lock. A physical run
connection owns execution/checkpoint fencing; never reconnect a locked operation
transparently. Worker presence uses a separate connection. New review admission
briefly waits for idle readers but rejects active execution immediately.

Browser tests use disposable e2e_ schemas and a synthetic provider. The retention
project runs after other projects to avoid deleting their fixtures. Stop only the
owned dev service, after checking its queue, before local tests need ports 3000/8000.
All destructive tests use synthetic schemas. GitHub uses gh outside the Windows
sandbox; sandbox authentication failures do not justify logout/login.

Windows Python defaults to CP1252 here. Read source as UTF-8 and write UTF-8 with
explicit LF newlines. Never commit .local/, credentials, private research, browser
state, exports or transcripts.

## Remaining work

[Issue #9](https://github.com/andersj05/ResearchChain/issues/9) still covers external
alerting, off-machine/PITR recovery, secret operations, strict usage controls and
workload-based hosting choices. Verify retention's final merge/live receipts, then
choose the next bounded operational improvement. Deployment still needs explicit
authorization and a concrete measured proposal.

[Issue #6](https://github.com/andersj05/ResearchChain/issues/6) needs actual owner
review of the paused research pilot and stricter spend follow-up. The provider's
preview cannot cap an in-flight response. [Issue #7](https://github.com/andersj05/ResearchChain/issues/7)
needs real holdouts, independent human labels and judge calibration.
Do not fabricate feedback, approve checkpoints, create new research calls or
claim exploratory calibration is a quality guarantee.

The private pilot remains an unreviewed four-section report with three original
sources and an unreviewed starter style guide. Private identifiers and the offline
review export are in .local/report-pilot.json and .local/pilot-report-review.zip.
The original real research pilot used 9,765 input and 4,135 output tokens and is
paused for final human review; no new model call was needed for retention.
