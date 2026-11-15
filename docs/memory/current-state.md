# Current state

Updated 2026-11-14. The evidence milestone is merged into dev through
[PR #22](https://github.com/andersj05/ResearchChain/pull/22), merge `81701c0`,
with seven feature commits and passing CI. Issue #5 is closed.
The runtime and visual editor are already merged into dev through
[PR #20](https://github.com/andersj05/ResearchChain/pull/20) and
[PR #21](https://github.com/andersj05/ResearchChain/pull/21). Issues #3 and #4 are closed.

## Verified capabilities

- The Next.js/UI SDK workbench edits chain and structured workflows, saves
  immutable revisions, reopens durable runs, and handles human review.
- Typed wiring, nested definitions, versions, grouped undo/redo, validated import,
  budgets, cancellation, and pinned workflow bundles are implemented. See
  [editor guide](../workflow-editor.md) and [structured workflows](../structured-workflows.md).
- Evidence captures permitted files up to 20 MiB, pasted text/data, and explicit
  link-only/missing/paywalled references. Postgres stores immutable originals,
  provenance, corrections, claims, and supporting/contradicting relationships.
- Screenshots, supplied OCR interpretations, digitized estimates, and numeric
  CSV/TSV sources remain distinct. Declared chart-derived lineage cannot be
  promoted through intermediate records or corrections. Originals are downloadable;
  safe images, text, and bounded tables have previews. Unknown facts stay unknown.
- Runs pin selected evidence versions, verify new artifact inputs, and preserve
  legacy manifests and retry receipts. Checkpoints continue to contain addresses,
  not original bytes. See [evidence guide](../evidence-desk.md) and
  [ADR 0004](../decisions/0004-evidence-provenance.md).
- `pnpm check` passed with 110 backend tests, lint, formatting, strict types, and
  a production build. All 40 Playwright tests passed against production with
  four workers. The suite covers evidence capture, inert content, conflicting
  claims, correction/pinning, paginated selections, mobile layout, 11 MiB upload
  byte integrity, and the existing runtime/editor including 128-node interactions.
  Final desktop/mobile captures were inspected. Local migrations through 0004
  were applied; test data used isolated schemas.
- Keep `ExecutionControl.lock` shared with `PostgresSaver.lock` for their shared
  connection. History uses indexed journal summaries and live advisory-lock
  detection; do not reintroduce graph recompilation into run-history reads.

## Next work and limits

Active branch: `feat/hypothesis-research`. The owner selected included ChatGPT Pro
usage through the official local-app Sign in with ChatGPT route. The provider
connection and setup commands are implemented; sign-in validation, protected
storage, refresh/revocation, account separation, and stream handling have focused
tests. Real browser consent succeeded. A completed `gpt-6.1-sol` connection response
reported 14 input and 8 output tokens through ChatGPT plan usage. See the
[connection guide](../chatgpt-plan.md) and [ADR 0005](../decisions/0005-chatgpt-plan.md).

The remaining [issue #6](https://github.com/andersj05/ResearchChain/issues/6) work is
the bounded live hypothesis workflow, independent evidence challenge, execution
budgets, reproducible manifests, and a human baseline comparison. Then come
[evals #7](https://github.com/andersj05/ResearchChain/issues/7) and
[report editing #8](https://github.com/andersj05/ResearchChain/issues/8).

One live connection check is verified. Research execution is not wired to the provider yet. Registering
links does not fetch websites. OCR/estimation is supplied, not automatically run.
The deterministic runtime is not yet a research agent. Source permissions and
metadata are user declarations; table parsing does not verify financial claims.
Authentication, remote hosting, retention/quotas, and backup operations remain
unimplemented. Originals and orphan uploads are retained in local Postgres.

## Workspace and commands

The repository is `C:\Users\jense\Desktop\ResearchChain`. The old
Documents/ChatGPT folder is empty. Use the Desktop path for all further work.
Run `pnpm dev` for the local workbench. Use `pnpm check` and `pnpm test:e2e` before
delivery. GitHub work uses `gh` outside the Windows sandbox, on feature branches
targeting dev. Keep commits coherent and frequent; the owner authorized merging
each completed milestone into dev after verification and CI.
