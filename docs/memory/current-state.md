# Current state

Updated 2026-11-14. The advanced runtime is recorded in
[PR #20](https://github.com/andersj05/ResearchChain/pull/20), targeting dev.
Use the PR for current CI and merge state. Prior milestones: durability in PR #16,
CLI workflow in PR #17, and the frontend redesign in PR #19 (merged into dev).

## Verified capabilities

- The Next.js/UI SDK workbench edits chain workflows, saves immutable revisions,
  reopens durable runs, and handles human review. The existing flat, square-corner
  design remains in place.
- Schema 0.2 adds typed ports/configuration, conditional branches, explicit
  parallel joins, bounded loops, and versioned nested definition bundles.
  Server validation rejects ambiguous control flow and unavailable data inputs.
- The new compiler preserves the legacy compiler and uses qualified invocation
  paths for nested reviews. Postgres stores node reservations, execution time,
  terminal cancellation/limit results, and the existing command journal.
- The API exposes the node registry and cancellation. The inspector renders
  simultaneous reviews individually, iteration paths, limits, and cancellation.
- Final local verification passed: `pnpm check` (75 backend tests and production
  build), `pnpm contracts:check`, and all 18 browser tests. Desktop/mobile run
  captures were inspected. CI passed on the implementation commit as well.
- Browser/CI testing exposed and fixed a shared-connection pipeline race; budget
  checks now share the checkpointer's mutex. History uses indexed journal summaries
  and detects Running through the live advisory lock, avoiding graph recompilation.
- Additive local development migrations were applied successfully.

## Next work

Next: editor issue #4, building on the issue #3 runtime:
port wiring/reconnection, typed configuration forms, subgraph navigation,
expand/collapse, grouped undo/redo, JSON import, validation diagnostics, and
large-graph interaction measurements. Structured graphs currently allow safe
name/instruction/layout edits; chain-only structural controls are disabled.

After #4: evidence/artifact ingestion (#5), one bounded real research workflow
(#6), evaluation definitions/comparisons (#7), and report editing/feedback (#8).
Provider credentials/calls, artifact bytes, authentication, hosting, and evaluation
are not implemented. Do not count this deterministic runtime as a research agent.

Read [structured workflows](../structured-workflows.md) and
[ADR 0003](../decisions/0003-structured-workflows.md) for limits and compatibility.
Time excludes completed review pauses; an abandoned execution interval is charged
conservatively through recovery, including downtime.

## Workspace and commands

The repository is now `C:\Users\jense\Desktop\ResearchChain`. The old
Documents/ChatGPT folder is empty. Use the Desktop path for all further work.

Run `pnpm db:migrate` for the new execution-control migration, then `pnpm dev`.
Use `pnpm check` and `pnpm test:e2e` before delivery. GitHub work uses `gh` outside
the Windows sandbox, on feature branches targeting dev. Keep commits coherent
and frequent; the owner has authorized merging each completed stage into dev.
