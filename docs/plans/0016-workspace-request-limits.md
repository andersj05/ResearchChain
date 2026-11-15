# Workspace request admission limits

## Problem and scope

Issue #6 limits each run, but separate runs, worker processes and the explicit
connection test can each admit more model requests. Issue #9 also needs an
operator control that applies across the owner workspace.

Add a rolling 24-hour request allowance and a pause switch. Start with 100
admissions per 24 hours; the owner can change this to 1–10,000 or pause new
admissions. This bounds requests, not dollars, tokens, provider-side billing or
requests already admitted. The existing per-run limits remain in force.

## Contract

- PostgreSQL owns immutable policy revisions and a durable admission ledger.
  Admit under one workspace advisory transaction lock, commit before invoking a
  model, and fail closed when the policy cannot be checked.
- Count every granted admission conservatively, including attempts whose later
  preparation, connection or response fails. Never refund or reuse an admission.
  Existing research attempts are imported conservatively during migration.
- All production research calls and provider:verify use the guard. Catalog reads,
  sign-in, local examples and operational reads do not consume allowance.
- Account switching, process restarts, run cleanup and new runs cannot reset the
  workspace count. The ledger contains random IDs, times, source categories and
  policy revision IDs, without research text or credentials.
- The physical execution connection retains its existing run/checkpoint locks.
  Admission transactions are short and do not cover network I/O.
- Each new research attempt exposes the policy revision used for admission.
  Previously completed results can be reused without consuming another slot.
- Pausing or lowering a limit affects later admissions. It does not cancel an
  already admitted request, restart a stopped run or approve a review checkpoint.
- Owner/Origin/CSRF-protected controls and the local operator CLI show the current
  policy, recent admissions and remaining slots. Compare policy revisions when
  saving; stale or ambiguous writes require a fresh read, never silent replay.
- The allowance covers this configured workspace and its database history. It
  cannot measure other apps/workspaces, provider-side credit consent, or requests
  missing from an old restored backup.

## Delivery

1. Commit the plan, then implement the migration, models and atomic guard.
2. Integrate research and explicit connection tests; verify the no-send boundary.
3. Add owner controls, API contracts, operator CLI and documentation.
4. Test concurrent processes at the last slot, pause/update races, restart,
   retention, rollback and clock/window boundaries with synthetic data.
5. Exercise real browser controls, access expiry, stale edits and failed writes.
6. Run pnpm check and pnpm test:e2e, rehearse migration on disposable data, and
   merge passing work into dev. Upgrade the idle local workspace with a verified
   backup and before/after research fingerprints.

No new inference, external notification, private purge or public deployment is
part of this implementation. Human pilot review, provider-side hard spend
controls, backup destinations and real external alerting remain open.
