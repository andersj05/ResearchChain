# Current state

Updated 2026-11-13. Issue #2 is implemented on `feat/durable-runs` in
[PR #16](https://github.com/andersj05/ResearchChain/pull/16), targeting `dev`.
Check GitHub for current CI and merge state; this note does not imply promotion
to `main`. Foundation PRs #1 and #10 were merged before this work.

## Verified capabilities

- Next.js 16 / React 19 workbench with pinned UI SDK beta canvas and tabs, locally
  bundled Geist fonts, and neutral Vercel-inspired styling.
- Workflow editing, undo, optional browser drafts, JSON export, immutable saved
  revisions, recent runs, and checkpoint-specific review/recovery controls.
- PostgreSQL 18.7 through local Docker Compose, loopback port 5433, named volume,
  explicit checksummed SQL migrations, and LangGraph `PostgresSaver` migrations.
- Validated revisions and run manifests are immutable at the database layer.
  Runs pin their original revision, brief, artifact references, and compiler version.
- Synchronous checkpoints plus a durable command journal survive API restarts and
  failures around checkpoint writes. Duplicate resumes return saved receipts;
  conflicting/stale decisions cannot approve the next review.
- Cross-process execution is serialized by a Postgres session advisory lock on
  the same physical connection used by the checkpointer. Reads never execute runs.
- Backend tests hard-kill/restart API processes and race conflicting decisions
  through two independent API workers. Tests use isolated schemas in real Postgres.
- Local Windows `pnpm check` passed: formatting, lint, TypeScript/Python types,
  24 backend tests, and production build. Nine browser tests passed, including
  refresh, stale controls, lost start responses, recovery UI, keyboard operation,
  and narrow layouts. Desktop/mobile screenshots were visually inspected.
- CI now runs Postgres and uploads browser screenshots/traces as
  `browser-test-results` for seven days. Consult PR #16 for its current Linux result.
- Python models still generate OpenAPI and browser types; contracts are committed.
  Main/dev protections, branch routing, and existing repository governance remain.

## Intentional limitations

This remains a local deterministic development slice. Notes record user text;
they do not call models or research sources. Schema 0.1 supports one connected
chain. Artifact inputs are content-addressed references; upload, byte storage,
and verification of availability are not implemented. No authentication, public
hosting, automatic recovery worker, publishing, or report evaluation is configured.

An interrupted request requires explicit recovery; a normal paused run can be
approved after restart. Use direct Postgres sessions, not transaction-mode poolers.
Future external tools need their own side-effect idempotency. Compiler changes
must preserve compatible executors or deliberately migrate existing runs.

## Next concrete task

Finish review/integration of PR #16, then
[issue #3](https://github.com/andersj05/ResearchChain/issues/3): bounded loops,
explicit joins, and nested subgraphs. Coordinate the schema and compiler changes
with editor issue #4; preserve the revision/recovery contracts in
[ADR 0002](../decisions/0002-durable-runs.md).

## Environment notes

Use `pnpm bootstrap`, `pnpm db:up`, `pnpm db:migrate`, then `pnpm dev`.
See [development](../development.md) for environment variables and recovery.
Docker Desktop was started and the local database initialized during issue #2.
`pnpm db:down` preserves its volume. Browser tests own ports 3000/8000 and must
run through root `pnpm test:e2e` after stopping an interactive dev server.

The GitHub CLI works outside the Windows sandbox. Its token lacks Projects scope;
the signed-in browser can manage the board. The connector returned 403 on writes
during foundation setup. See root `AGENTS.md` and [GitHub configuration](../github.md).
