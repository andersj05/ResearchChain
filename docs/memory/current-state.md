# Current state

Updated 2026-11-14. The evaluation workbench is merged into dev through
[PR #25](https://github.com/andersj05/ResearchChain/pull/25), merge `2dba860`,
with eight feature commits and passing PR CI. Active branch: `feat/report-editing`.
The owner authorized frequent commits and merging completed steps into dev after CI.
Do not promote changes to main or publish the application.

## Evaluation implementation

The evaluation desk now supports separate reference outputs, immutable dataset
revisions, development/holdout checks, frozen-writing and full-research tracks,
recorded/imported candidates, randomized blind comparisons, explicit quality gates,
writing ratings, reasons and exact Unicode edits. Saving feedback reveals provenance.
Judge predictions must precede human feedback; synthetic and ineligible data are
excluded from calibration. Imports are unverified read-only archives and never
create local labels. See [the guide](../evaluations.md),
[ADR 0007](../decisions/0007-evaluations.md), and [plan 0006](../plans/0006-evaluations.md).

Reference checks are metadata/copy checks, not semantic leakage proofs. Historical
checks require verified capture timing and dated metadata; unknown vintages block
export. Dates are UTC calendar days and do not check intraday release times. The
calibration collection threshold is exploratory, not a reliability guarantee.
Real independent human labels and held-out studies are still required for issue #7.

Migration 0006 is applied locally. The prior research pilot is registered as one
development case with its published EquityCats reference kept outside generation
inputs and one recorded candidate. The case is explicitly synthetic because it uses
an illustrative numeric fixture; it is excluded from calibration. No comparison,
human label, judge prediction or new model call was created during this setup.
Private setup identifiers and exports remain in ignored `.local/` and Postgres.

Validation: PR CI `43675847316` passed on `5158987`, including 206 backend tests,
formatting, lint, strict Python/TypeScript checks, contract drift and a production
build. All 51 browser tests passed in CI; the same full suite also passed locally
against production with four workers and retries disabled. Desktop/mobile screens
were inspected. The added tab's narrow-screen overflow was fixed. The automatic
dev check on merge `2dba860` also passed (`43676146112`).

## Prior research milestone

Research [PR #24](https://github.com/andersj05/ResearchChain/pull/24) merged to dev as
`74f991d`; PR and post-merge CI passed. Workflow 0.3 runs hypothesize/challenge/revise
against captured evidence with pinned settings, prompts, account and artifacts.
Attempts are journaled before sending; uncertain outcomes are not automatically
resent. Progress, cancellation, exact quotations and citations are validated, while
semantic truth and independent source support remain human judgments.

The real three-stage `gpt-6.1-sol` pilot used 9,765 input and 4,135 output tokens and
remains paused for final human review. Its narrow conditional mechanism comparison
was development feedback, not a blind study or empirical market forecast.
[Issue #6](https://github.com/andersj05/ResearchChain/issues/6) stays open for owner
review and strict spend follow-up: token thresholds gate subsequent calls and cannot
cap an in-flight response. Provider-side credit settings are not attested by the app.

The owner chose ChatGPT Pro included usage with no paid API fallback. The existing
saved account still reports plan usage enabled. A requested sign-in restart timed
out without a completed callback; it did not remove the existing connection. Do not
restart sign-in again unless the user asks or an actual authentication error requires
it. No API key, paid credit purchase or new provider inference was used for evals.

Runtime PR #20, editor PR #21, evidence PR #22 and connection PR #23 are merged into
dev. Issues #3–#5 are closed. Keep ExecutionControl.lock shared with PostgresSaver.lock.

## Next work

Implement [report editing #8](https://github.com/andersj05/ResearchChain/issues/8)
using [plan 0007](../plans/0007-report-editing.md). Keep #7 open
for real holdout collection and independent human feedback/calibration. Do not invent
labels, pretend synthetic tests are research evidence, fine-tune, or optimize a lone
judge score. Real empirical research also needs independent dated market/positioning
sources; the pilot records that gap.

The repository is `C:\Users\jense\Desktop\ResearchChain`; the old Documents/ChatGPT
folder is empty. Run `pnpm dev`, `pnpm check`, and `pnpm test:e2e`. Browser tests use
isolated `e2e_` schemas and a synthetic provider, never the connected account. GitHub
work uses `gh` outside the Windows sandbox. Keep credentials, private sources,
exports and browser state out of this public repository. Authentication, remote
hosting, retention/quotas and backup operations remain future work.
