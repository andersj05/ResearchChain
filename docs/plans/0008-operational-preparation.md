# Operational preparation: backup and restore first

Tracked by [issue #9](https://github.com/andersj05/ResearchChain/issues/9).
The first implementation slice is `feat/backup-restore`, based on the merged
report editor. Completing planning does not authorize production deployment.

## First deliverable

Build a reproducible backup and restore workflow for the current local Postgres
workbench. Evidence originals, immutable workflow/report/style/evaluation records,
run commands, model journals and LangGraph checkpoints all live in Postgres.
The Compose baseline is PostgreSQL 18.7; use compatible PostgreSQL client tools.

Create a consistent binary archive plus a manifest with format/version, migration
checksums, archive checksum and bounded aggregate verification information. Keep
connection credentials out of process arguments, manifests, logs and exceptions.
Write private archives under an explicitly chosen ignored destination, preserve
binary bytes on Windows, and avoid incomplete files being mistaken for backups.

Restore into a separate, explicitly named target and test there. Never overwrite
the source database, silently drop an existing target, resume a model call, or
replace the owner's live data as part of a verification exercise. Treat an archive
as executable database input: checksums establish integrity, not trust, and restore
credentials/targets must constrain its effects. Protected provider credentials are
outside the research database and need a separate reconnection/recovery procedure.

Verify schema compatibility, original-byte hashes, immutable records and paused
workflow/checkpoint state. Demonstrate a synthetic review/resume flow after restore
without external inference. Reject incomplete, altered or incompatible backups
with redacted errors. Document migration failure and rollback as a tested recovery
procedure, including which code version can read the restored database.

Use isolated synthetic databases for automated testing. If a private owner backup
is made for a manual rehearsal, keep it ignored and verify only aggregate outcomes.
A running local dev server must be revalidated and stopped before browser tests;
do not assume an old service handle is still live.

## Remaining operational slices

- Add workbench authentication and project/run/artifact authorization. Provider
  sign-in is a separate identity boundary and must not substitute for app access
  control. Cover every read, mutation, export and content-addressed lookup.
- Define durable worker ownership, cancellation/recovery, effect idempotency,
  request limits and scoped tool access. Preserve uncertain-provider outcomes
  without automatic duplicate inference.
- Add secret handling, redacted observability, explicit retention and usage limits.
  Keep token-threshold and provider-credit limitations visible; do not represent
  an in-flight threshold as a guaranteed financial cap.
- Measure representative workloads and data growth, then compare current hosting
  costs and prepare concrete configuration for review. Keep services on loopback
  until the authorization and operational requirements are satisfied.

Deliver coherent slices through CI-reviewed PRs to dev. Keep issue #9 open until
all of its criteria are satisfied. Issues #6/#7 still need owner research review
and independent evaluation evidence; operational work must not fabricate them.
