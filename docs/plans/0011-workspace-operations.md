# Workspace operations

Status: implemented on feat/workspace-operations for issue #9; require passing CI before merge.

## Outcome

Add an owner-only Operations view and local CLI showing connected worker consumers,
shared execution capacity, queue states, storage and reported model usage. Observing
status must not invoke providers, expose research content or change run state.

The durable-worker prerequisite merged in PR #29 as 1d143c8. The live workspace is
on migration 0008; private upgrade receipts verified retained research and an empty
queue. Post-merge CI 43701571474 passed. Existing ChatGPT plan access was refreshed.

## Implementation

- Register each serving worker through a shared session advisory lock on its own
  presence connection. Keep command/checkpoint connection fencing unchanged.
- Sample workspace-scoped locks and aggregate database records. Distinguish queued,
  executing, abandoned and interrupted commands. Connection presence is not a
  guarantee of provider responsiveness.
- Report stored bytes and reported usage, including missing token counts. Do not
  estimate billing, remaining plan allowance or automatic spend enforcement.
- Offer manual refresh in an Operations tab, protected by normal owner access.
  Do not introduce background polling that extends owner session idle time.
- New reviews briefly wait for idle readers instead of falsely reporting execution.
  Long reads remain retryable; active work is rejected immediately.
- Verify real worker lifecycle, queue classification, workspace isolation, redaction,
  session protection and desktop/mobile behavior using synthetic data only.
- Run pnpm check and the production browser suite; commit coherent steps and merge
  into dev after CI. No main promotion or public deployment.

## Following milestone: retention controls

Keep data by default. Deletion needs a bounded preview, explicit confirmation,
dependency rechecks and idempotent receipts. Protect report/evaluation references,
human-review checkpoints and uncertain or active model effects. Keep minimal run-ID
tombstones so delayed retries cannot resurrect deleted work. Coordinate writers and
purges with consistent lock ordering; JSON references need concurrency protection
as well as relational foreign keys. Preserve immutable updates while narrowly
authorizing selected deletions. Test with synthetic data; never purge the owner's
private workspace as part of implementation. Operations inventory alone does not
satisfy retention acceptance criteria.
