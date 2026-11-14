# Current state

Updated 2026-11-14. The visual editor is merged into dev through
[PR #21](https://github.com/andersj05/ResearchChain/pull/21), merge `1f05f58`,
with eight feature commits and passing CI. Issue #4 is closed. The advanced
runtime was merged in [PR #20](https://github.com/andersj05/ResearchChain/pull/20);
issue #3 is closed as well.

## Verified capabilities

- The Next.js/UI SDK workbench edits chain and structured workflows, saves
  immutable revisions, reopens durable runs, and handles human review.
- Typed pointer/keyboard port wiring and reconnection, advanced templates and
  configuration forms, nested breadcrumbs and expandable previews, separate
  definition versions, grouped undo/redo, validated JSON import/export, and
  visible server diagnostics are implemented. Unused definitions can be pruned;
  malformed branch deletion preserves unrelated downstream work.
- Existing run bundles stay pinned while nested draft definitions and versions
  change. Review actions now appear before completed-step history.
- `pnpm check` passed (75 backend tests, lint, formatting, type checks, production
  build). All 34 Playwright checks passed against the production build: 33 in the
  full suite plus the separately measured one-worker 128-node test. Final desktop
  and mobile captures were inspected. [Editor guide and measurements](../workflow-editor.md).
- The 128-node production measurements recorded median/p95: nudge 35.1/46.5 ms,
  pan 16.7/18.2 ms, zoom 20.9/27.2 ms. These are local synthetic event-to-next-frame
  observations, not physical input latency or cross-machine guarantees.
- Schema 0.2 includes typed control/data, conditional branches, parallel joins,
  bounded loops, and pinned definition bundles. Compiler/runtime guards enforce
  execution/time/concurrency budgets and preserve the legacy compiler.
- Keep `ExecutionControl.lock` shared with `PostgresSaver.lock` for their shared
  connection. History uses indexed journal summaries and live advisory-lock
  detection, avoiding graph recompilation and nonblocking-history regressions.
- Local database migrations for durable runs and execution controls were applied.

## Next work

Active: evidence/artifact ingestion (#5) on `feat/evidence-provenance`, starting
from `1f05f58`. See [implementation sequence](../plans/0003-evidence-provenance.md).
Start with immutable provenance records and bounded content-addressed storage,
then original inspection, claim/evidence relationships, and run attachment UI.
Next come one bounded real research workflow (#6), evaluations/comparisons (#7),
and report editing/feedback (#8).

Provider credentials/calls, artifact bytes, authentication, hosting, and evaluation
are not implemented. The deterministic runtime is not yet a research agent.
Read [structured workflows](../structured-workflows.md) and
[ADR 0003](../decisions/0003-structured-workflows.md) for limits and compatibility.
Time excludes completed review pauses; an abandoned execution interval is charged
conservatively through recovery, including downtime.

## Workspace and commands

The repository is `C:\Users\jense\Desktop\ResearchChain`. The old
Documents/ChatGPT folder is empty. Use the Desktop path for all further work.

Run `pnpm dev` for the local workbench. Use `pnpm check` and `pnpm test:e2e` before
delivery. GitHub work uses `gh` outside the Windows sandbox, on feature branches
targeting dev. Keep commits coherent and frequent; the owner has authorized
merging each completed stage into dev.
