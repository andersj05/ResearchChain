# Current state

Updated 2026-11-15. Report editing is implemented in
[PR #26](https://github.com/andersj05/ResearchChain/pull/26), targeting dev.
Active branch: `feat/report-editing`. Local validation is complete; final-head CI
and merge are still pending. The owner authorized frequent commits and merging
completed steps into dev after CI. Do not promote to main or deploy publicly.

## Report editing

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
style pinning, review invalidation and export. Final CI must pass before merging.
Migration 0007 is not yet applied to the owner's public schema.

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

The owner chose ChatGPT Pro included usage with no paid API fallback. The saved
account still reports plan usage enabled. A previous sign-in restart timed out
without removing the working connection. Do not restart it again unless newly
requested or required by a real authentication failure.

Runtime PR #20, editor PR #21, evidence PR #22 and connection PR #23 are merged;
issues #3–#5 are closed. Keep ExecutionControl.lock shared with PostgresSaver.lock.

## Next work

Finish PR #26 CI/merge, apply migration 0007, and prepare the existing private
research pilot in the report editor with an explicitly unreviewed starter guide.
Do not create human feedback or approve its research review.

Then prepare [operational controls #9](https://github.com/andersj05/ResearchChain/issues/9):
authentication/authorization, execution and request limits, secrets, redacted
observability, retention, tested backup/restore and deployment configuration.
The issue explicitly requires workload measurements before hosting selection and
does not authorize a production deployment. Keep #6/#7 human review work open.

The repository is `C:\Users\jense\Desktop\ResearchChain`; the old Documents/ChatGPT
folder is empty. Browser tests use isolated `e2e_` schemas and a synthetic provider.
GitHub work uses `gh` outside the Windows sandbox. Do not commit credentials,
private sources, exports or browser state.
