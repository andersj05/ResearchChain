# Current state

Updated 2026-11-15. Durable workers are implemented in
[PR #29](https://github.com/andersj05/ResearchChain/pull/29) on feat/durable-workers.
The owner authorized frequent commits and merging completed steps after CI.
Do not promote to main or deploy publicly.

## Durable workers

Start, resume and recover now return HTTP 202 command receipts. A separate local
worker follows durable jobs using workspace-wide slot locks and the existing
physical run/checkpoint connection. Defaults are two parallel commands and 100
pending commands. API restarts do not stop independent workers, and duplicate
requests return the same receipt without waiting for model execution.

New commands recover abandoned ownership from confirmed progress, with at most
three automatic ownership losses before explicit recovery. Uncertain model effects
are never resent. Old unfinished commands are not automatically enqueued, paused
human reviews remain paused, and restored pending jobs are held for explicit review.
The browser preserves an unconfirmed start's request ID through refresh and follows
queued work. execution_pending keeps polling terminal runs until their worker has
saved final progress, including a cancelled partial model response.

Migration/backup lock waiters now poll outside transactions, avoiding a real
deadlock with concurrent checkpoint indexes. The regression covers concurrent
fresh migrations and a backup waiting while an index migration completes.

CI [43700300306](https://github.com/andersj05/ResearchChain/actions/runs/43700300306)
passed on 0e92425: pnpm check with 300 backend tests, formatting, lint, strict
Python/TypeScript checks and the production build; all 67 production browser tests
passed. The local 67-case development browser suite also passed with four workers
and retries disabled. Desktop and phone queued-run screenshots were inspected.
The final local full check and production run are recorded in ignored
.local/workers-final-check-v2.log and .local/workers-production-browser.log.

A compatible clean e7ee33e checkout created a private schema-7 backup and restored
it into a separate database. Migration 0008 preserved every existing table
fingerprint, all 12 originals and 129,817 original bytes. The restored queue was
empty and a worker performed no inference. The four-section report remained
unreviewed with no feedback; its research run remained paused. The source stayed
on schema 7 during this rehearsal. The backup location, compatible code and
verified target are in ignored .local/worker-upgrade-rehearsal.json.

Before changing or assuming the live service state, inspect the private aggregate
receipts .local/workers-live-upgrade.json and .local/workers-live-check.json when
present. The prepared upgrade verifies the retained backup checksum and exact
source inventory before migrating. API, browser and worker must use matching code.
See [workers](../workers.md), [ADR 0011](../decisions/0011-durable-workers.md) and
[plan 0010](../plans/0010-durable-workers.md).

## Owner access

The workbench has a separate owner sign-in. Initial enrollment/recovery uses a
five-minute, single-use link issued by `pnpm access:login`; normal visits use an
Argon2id password. Sessions expire after 30 idle minutes or 12 hours, support
revocation and require exact Origin plus session-bound CSRF on mutations.
Every private API, original hash, export and execution action is protected.
Health is minimal; documentation moved under the protected /api prefix.

One configured database target/schema is one owner workspace. Requests cannot
select a different scope. Existing records and hashes need no data migration.
Owner state is protected separately from research backups and provider credentials.
This does not add collaborator accounts, public hosting, paid API access or model calls.
See [the operator guide](../owner-access.md) and
[ADR 0010](../decisions/0010-owner-workspace-access.md).

The browser preserves open drafts through reauthentication for the same identity,
scopes saved drafts by owner/workspace, requires explicit legacy-draft import and
does not replay rejected mutations. A controlled regression also verifies that a
late style-list refresh cannot remove a newly saved guide. Stale-review coverage
now holds a captured old request instead of depending on UI timing.

Owner access [PR #28](https://github.com/andersj05/ResearchChain/pull/28)
merged as e7ee33e with passing PR and dev CI, 273 backend tests and 63 production
browser tests. Its live check verified protected reads and the existing Pro
connection without inference or review decisions. Those historical aggregates
are in ignored .local/owner-access-live-check.json; use the newer worker receipts
for current service state. A fresh local owner link is available through
pnpm access:login when the owner needs to reconnect.

On Windows, Python's default text encoding here is CP1252. Always read source as
UTF-8 and write UTF-8 with explicit LF newlines; otherwise Unicode anchors and
labels can be damaged, or local Prettier checks can fail on CRLF despite a clean
normalized Git diff. The introduced encoding changes were repaired and verified.

Issue #9 remains open for retention, redacted operations, off-machine recovery,
secret operations and measured hosting decisions. Issues #6 and #7 still require
actual owner review/labels and their documented provider/evaluation work.

## Backup and recovery

The local backup/restore slice of [issue #9](https://github.com/andersj05/ResearchChain/issues/9)
is merged and verified. It creates private
PostgreSQL custom archives with a manifest sharing the same exported snapshot.
The migration lock is acquired before that snapshot. Restore requires a trusted
archive and a new database, uses a temporary restricted owner, verifies migration,
schema, table and original-byte hashes, then transfers ownership. Failed targets
are quarantined; no source replacement, automatic app switch or provider call occurs.

`pnpm check` passed with 240 backend tests, formatting, lint, strict Python and
TypeScript checks, and the production build. The 23 new tests cover binary originals,
reports/feedback/style/evaluations, paused resume, uncertain model requests,
concurrent writes, migration locking, public-schema restore, partial-upgrade
recovery, corruption/target guards, private permissions and redacted errors.
CI selects its Postgres service container for matching client tools.
PR CI `43683923758` passed on `626f009`, including all 55 production browser
tests. Post-merge dev CI `43684326455` passed on `5c13438`. Strict Python
checks also passed for both Linux and Windows; process flags are detected portably.

A private owner rehearsal from clean commit `1342cef` verified 27 tables, 86 rows
and 12 originals (129,817 bytes) in a separate database, with zero provider calls.
The live database was not switched. Ignored `.local/backup-rehearsal.json` records
the private destination and receipt; the archive directory contains the complete
manifest and restore receipt. Before owner-access work, the local workbench was verified on the original database:
API health was healthy and the saved active Pro account reported plan usage enabled. The pilot remains
an unreviewed four-section report with no feedback. Revalidate and stop the owned
dev service before future browser tests.
See [the operator guide](../backups.md) and [ADR 0009](../decisions/0009-verified-backups.md).

This is a local logical backup, not PITR or a full-cluster backup. Provider
credentials, roles/grants, external schemas and server settings are excluded.
Archives contain executable SQL and must be trusted. Retention/off-machine copies
and hosted recovery objectives remain operational work.

## Report editing

[PR #26](https://github.com/andersj05/ResearchChain/pull/26) merged as `c9bc2d0`;
issue #8 is closed.

The Reports tab seeds an immutable report from a completed research attempt.
It supports ordered section drafting, fact/interpretation/scenario classifications,
captured quotations and chart originals, pinned source snapshots, versioned
analytical/voice guides, exact-version comments and Unicode anchors, predecessor
preferences and scoped accept/reject decisions. New revisions start unreviewed.

Saves have optimistic concurrency and idempotent receipts. Per-revision browser
drafts and pending request IDs survive refresh; conflicts retain the user's text.
Offline ZIP exports contain escaped HTML, JSON provenance, review status, the pinned
guide and original source bytes. This is human editing of saved research; no
provider call, automatic rewriting, publication or training consent is introduced.
Style defaults are illustrative guidance, not owner-approved voice.
See [the guide](../reports.md) and [ADR 0008](../decisions/0008-report-editing.md).

Validation: `pnpm check` passed with 217 backend tests, formatting, lint, strict
Python/TypeScript checks and a production build. A subsequent binary-export schema
correction passed its focused API/export test and regenerated contracts.
The full production browser suite passed all 55 tests with four workers and retries
disabled. Desktop/mobile report screenshots were inspected. The browser cases cover
draft recovery, lost-response retries, conflicting saves, exact Unicode anchoring,
style pinning, review invalidation and export. PR CI `43679633006` passed on
`743972c`; post-merge dev CI `43680029694` passed on `c9bc2d0`.

Migration 0007 is applied locally; do not edit its checksum. The existing final
research result is now a private, unreviewed four-section report with three source
originals and an explicitly unreviewed editorial starter guide. It has no feedback,
made no additional model attempt, and left the research run paused. The offline
review export's three original hashes were verified. Private identifiers/setup and
the ZIP remain in ignored `.local/report-pilot.json`, `.local/register-report-pilot.py`
and `.local/pilot-report-review.zip`. The live local API returned the report
successfully; opening its Codex browser tab was queued, not visually confirmed.

## Evaluation and research

Evaluation [PR #25](https://github.com/andersj05/ResearchChain/pull/25) merged to dev
as `2dba860`; PR CI `43675847316` and dev CI `43676146112` passed.
The desk supports immutable datasets, separate references, development/holdout
checks, frozen-writing/full-research tracks, blind comparisons, exact edits and
preregistered judge predictions. Imported archives are unverified and never become
local calibration data. Checks detect metadata/copy issues, not all semantic leakage.
The exploratory calibration threshold is not a quality guarantee. See
[the evaluation guide](../evaluations.md) and [ADR 0007](../decisions/0007-evaluations.md).

Migration 0006 is applied locally. The prior research pilot is registered as one
synthetic development evaluation case with its published EquityCats reference
outside generation inputs and one recorded candidate. No owner feedback, judge
prediction or new model call was fabricated. Private setup data stays in ignored
`.local/` and Postgres. [Issue #7](https://github.com/andersj05/ResearchChain/issues/7)
remains open for real holdouts, independent human labels and judge calibration.

Research [PR #24](https://github.com/andersj05/ResearchChain/pull/24) merged as
`74f991d` with passing CI. The real three-stage `gpt-6.1-sol` pilot used 9,765 input
and 4,135 output tokens and remains paused for final human review.
[Issue #6](https://github.com/andersj05/ResearchChain/issues/6) stays open for that
review and strict spend follow-up: thresholds gate later calls and cannot cap an
in-flight response. Provider-side credit settings are not attested by the app.

The owner chose ChatGPT Pro included usage with no paid API fallback. Expired
sign-in restarts leave the saved connection intact. Recheck its current state with
provider:status or the protected provider-status endpoint; no inference is needed.
Restart sign-in only when newly requested or required by an authentication failure.

Runtime PR #20, editor PR #21, evidence PR #22 and connection PR #23 are merged;
issues #3–#5 are closed. Keep ExecutionControl.lock shared with PostgresSaver.lock.

## Next work

Confirm PR #29's merge and dev CI, then verify the live upgrade and local service
against the private receipts above. Continue
[operational controls #9](https://github.com/andersj05/ResearchChain/issues/9)
with redacted worker/queue health and explicit retention controls. Plan deletion
around pinned evidence, reports, evaluations and checkpoints; do not infer consent
to delete private data. Off-machine/PITR recovery, secret operations, strict usage
limits and workload-based hosting choices remain separate work.

Keep #6/#7 human review work open; do not invent feedback, labels or new research
calls. One owner per configured workspace remains the implemented access scope.

The repository is C:\Users\jense\Desktop\ResearchChain; the old Documents/ChatGPT
folder is empty. Browser tests use isolated e2e_ schemas and a synthetic provider.
GitHub work uses gh outside the Windows sandbox. Do not commit credentials,
private sources, exports or browser state.
