# Explicit retention controls

Status: implemented in PR #31 for issue #9; merge after final CI.

## Outcome

Keep data by default. Let the owner preview and explicitly confirm a bounded batch
of terminal runs created before a chosen cutoff. Delete their execution history,
checkpoints and exclusively owned originals only after rechecking references.
Preserve evidence, reports, evaluations, workflow revisions, shared originals,
human-review pauses, unfinished commands and uncertain model effects.

## Implementation

- Persist a fifteen-minute preview with exact selected IDs, fingerprints, counts,
  retained-original counts and protection reasons. The cutoff refers to run
  creation, not last activity. Limit each batch to ten runs.
- Require the preview digest and an explicit DELETE confirmation. Recheck the whole
  selection atomically; a changed dependency or run requires a fresh preview.
  An acknowledged or lost-response retry returns the same immutable receipt.
- Coordinate all writers through a workspace retention lock. Purges acquire
  admission, exclusive retention, then nonblocking run locks; never wait for an
  executing run while holding retention. Stale JSON references are rejected after
  deletion, including references held by report/evaluation creators.
- Keep permanent minimal run tombstones before any provider account selection.
  Deleted original addresses reject stale references; a valid identical upload can
  recreate its original and clear that address tombstone.
- Keep immutable updates forbidden. Permit only transaction-scoped deletes of
  explicitly selected run records and originals; never disable immutable triggers.
- Retain orphan uploads unrelated to selected runs, external exports and backups.
  Do not claim complete erasure or immediate physical database-size reclamation.
- Add owner-protected endpoints and a manual Operations cleanup panel. Preserve
  request identity across lost replies; no automatic cleanup or background polling.
- Verify dependency coverage, lock races, stale retries, isolation, original
  reupload, access protection and browser confirmation using synthetic data only.
- Rehearse migration 0009 on a verified restored private copy before upgrading the
  live workspace. The migration itself must preserve all existing research.
- Commit coherent steps; run pnpm check and production browser tests, merge to dev
  after CI, then verify the live migration without deleting private data.

Prerequisite: operations PR #30 merged as acd22c1. PR and dev CI passed with 314
backend tests and 71 production browser tests. The live schema-8 comparison
preserved all 29 table fingerprints and 12 originals, with no new model request.
