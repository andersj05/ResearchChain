# Current state

Updated 2026-11-14. The live research implementation is on `feat/bounded-research`,
starting from the ChatGPT-plan connection merge `dcf5ffa` ([PR #23](https://github.com/andersj05/ResearchChain/pull/23)).
The owner authorized frequent commits and merging completed steps into dev after CI.

## Implemented research step

- Workflow 0.3 adds hypothesize/challenge/revise stages, model/settings selection,
  typed result and review-feedback wiring, and a ready-to-use research template.
  Legacy 0.1/0.2 canonical hashes and pinned compiler behavior are preserved.
- Model attempts are journaled before sending. Completed attempts are reused after
  recovery; uncertain outcomes are stopped without automatic resend. Prompts,
  model IDs, account registration, limits, evidence snapshots and payloads are pinned.
- Results include alternatives, falsifiers, questions and evidence requests.
  Citation IDs, source representations, exact quotations and stable hypothesis IDs
  are checked. Semantic truth and source independence still require review.
- Progress reads and cancellation work during model calls. Calls are serialized
  per run even in forks, with call/tool/time/input/output limits and a token threshold
  that gates subsequent calls. The provider cannot hard-cap an in-flight response.
- The workbench displays results, saved payloads, usage, model choice and reviewer
  feedback. Final review remains explicit. No publication or trading is performed.

A real three-stage `gpt-6.1-sol` pilot completed through the owner's connected plan,
used 9,765 input and 4,135 output tokens, and is paused for human review. The baseline
was the owner's published EquityCats reference article, kept out of model inputs.
The comparison was a narrow development check of a conditional mechanism, not a
blind evaluation or an empirical market forecast. Private run/comparison artifacts
remain in local Postgres and ignored `.local/`; never commit them.

See [the workflow guide](../hypothesis-research.md),
[ADR 0006](../decisions/0006-research-attempts.md), and
[implementation plan](../plans/0005-bounded-research.md).

## Prior milestones and checks

Runtime [PR #20](https://github.com/andersj05/ResearchChain/pull/20), editor
[PR #21](https://github.com/andersj05/ResearchChain/pull/21), evidence
[PR #22](https://github.com/andersj05/ResearchChain/pull/22), and connection PR #23
are merged into dev. Issues #3–#5 are closed. The connection was verified through
real browser consent and a completed model response; no API key or credit purchase.

Research checks passed before final review fixes with 167 backend tests and all
46 browser scenarios (one concurrent-reader race exposed by a retry). That race
is fixed with a backend regression test. Final checks now include 169 backend and
47 browser scenarios; their final outcomes and PR CI must be verified before merge.
Desktop/mobile research screens were inspected. Migration 0005 is applied locally.

## Next work and limits

Finish verification and merge the research step into dev. Keep
[issue #6](https://github.com/andersj05/ResearchChain/issues/6) open for the owner's
pilot review and follow-up on strict spend enforcement: provider-side credit
settings are not exposed or attested by this app, and reported-token limits can be
exceeded by a response already in flight. Do not promise a hard dollar/token cap.
The owner selected included ChatGPT Pro allowance without paid API fallback.

Next are [evals #7](https://github.com/andersj05/ResearchChain/issues/7) and
[report editing #8](https://github.com/andersj05/ResearchChain/issues/8). Use the pilot's
source-discipline observations to design evals, while keeping development references
separate from holdouts. Real empirical research still requires dated independent
market/positioning sources. The current pilot explicitly identifies that gap.

The evidence desk retains immutable originals, corrections, provenance and claim
relationships. Links do not fetch websites. OCR/estimation is supplied, not automatic.
Application authentication, remote hosting, retention/quotas and backup operations
remain unimplemented. Keep ExecutionControl.lock shared with PostgresSaver.lock.

## Workspace

The repository is `C:\Users\jense\Desktop\ResearchChain`. The old
Documents/ChatGPT directory is empty. Use the Desktop path for all repository work.
Run `pnpm dev`, `pnpm check`, and `pnpm test:e2e`. Browser tests inject a synthetic
provider only in isolated `e2e_` schemas and never contact the connected account.
GitHub work uses `gh` outside the Windows sandbox. Feature PRs target dev; do not
promote to main without authorization.
