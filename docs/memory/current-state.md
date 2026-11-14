# Current state

Updated 2026-11-14. The frontend redesign is on `feat/workbench-redesign` in
[PR #19](https://github.com/andersj05/ResearchChain/pull/19), targeting `dev`.
Durability is recorded in [PR #16](https://github.com/andersj05/ResearchChain/pull/16);
the CLI workflow is recorded in [PR #17](https://github.com/andersj05/ResearchChain/pull/17).
Use those PRs for current CI and merge state.

## Verified capabilities

- The Next.js/UI SDK workbench supports workflow editing, saved revisions, run
  history, and human review. The redesign adds a flat full-height shell, colored
  step identities, collapsible panels, a step outline, zoom/fit controls, and a
  focused run setup dialog. See [design conventions and audit](../design.md).
- Postgres stores immutable revisions/manifests, synchronous LangGraph
  checkpoints, and a command journal. Runs survive API restart; repeated and
  concurrent approvals cannot advance the same review twice.
- PR #19 passed `pnpm check` (including 24 backend tests and a production build)
  and 11 browser tests locally. Desktop/laptop, run setup, review, and mobile
  captures were visually inspected. Tests cover durable runs plus dialog focus,
  panel toggles, outline selection, viewport controls, and responsive layouts.
- Development tracking uses issues and PRs through `gh` only. Follow
  [the CLI workflow](../github.md); do not maintain GitHub Projects.

## Limits and next work

This is a local deterministic chain of note, review, and finish nodes. Provider
calls, artifact upload/storage, authentication, hosting, and report evaluation
remain future work. Artifact inputs are content-addressed references only.
Recovery requires direct Postgres sessions and compatible compiler versions;
see [ADR 0002](../decisions/0002-durable-runs.md).

Next: [issue #3](https://github.com/andersj05/ResearchChain/issues/3), bounded
loops, explicit joins, and nested subgraphs, coordinated with editor issue #4.

## Local setup

Run `pnpm bootstrap`, `pnpm db:up`, `pnpm db:migrate`, then `pnpm dev`.
See [development](../development.md) for recovery and test commands. Browser
tests use isolated database schemas and own ports 3000/8000. Verify GitHub CLI
operations outside the Windows sandbox as directed by `AGENTS.md`.
