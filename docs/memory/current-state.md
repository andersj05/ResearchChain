# Current state

Updated 2026-11-13. Foundation implementation is tracked in
[PR #1](https://github.com/andersj05/ResearchChain/pull/1). Check GitHub for its
current merge state instead of inferring it from this note.

## Verified capabilities

- Next.js 16 / React 19 custom workbench with pinned UI SDK beta canvas behaviors.
- Edit node labels, types, instructions, positions, start node, and connections;
  undo, save/load a browser draft, and export workflow JSON.
- FastAPI validates version 0.1 workflows and compiles them into LangGraph.
  A review node pauses at a real checkpoint; approve/reject resumes that run.
- Runs keep their original workflow snapshot. Unknown node types, invalid topology,
  loops, branches, and unreachable nodes are rejected, not silently approximated.
- Python models generate OpenAPI and browser TypeScript types; CI checks drift.
- Local Windows checks passed: formatting, lint, type checks, 12 backend tests,
  production build, and 4 browser tests. The initial Linux GitHub CI run also passed,
  including the production browser flow. Subsequent commits require their own CI.
- Protected main/dev branches, pinned CI actions, secret scanning/push protection,
  weekly dependency PR configuration, templates, and CODEOWNERS are set up.
- Four milestones and issues #2–#9 define next work, tracked through issues and PRs.

## Intentional limitations

This is a deterministic local development slice, not an automated research product.
Notes record user text; they do not call models or research sources. Version 0.1
supports one connected chain. Runs/checkpoints disappear on API restart (capacity
100); drafts live in one browser. No authentication, hosted deployment, provider
credentials, publishing, durable evidence store, or report evaluation is configured.

## Next concrete task

[Issue #2](https://github.com/andersj05/ResearchChain/issues/2): durable workflow
revisions and Postgres checkpoints, verified by restarting and resuming a paused run.
Implementation is in [PR #16](https://github.com/andersj05/ResearchChain/pull/16)
on `feat/durable-runs`, still open as of 2026-11-14. Review/integrate that PR next;
coordinate its schema with advanced control flow (#3) and the visual editor (#4).

## Environment notes

Use `pnpm bootstrap`, then `pnpm dev`. See `docs/development.md`.
The original repository history and public visibility were preserved. See
`docs/github.md` for settings and branch policy.

Workflow update, 2026-11-14: use GitHub issues and PRs through `gh` only. GitHub
Projects is retired from agent instructions; no browser or Projects scope is
needed. Repository settings now specify `has_projects: false` for the next apply;
this documentation change does not modify the remote board or repository settings.
The GitHub CLI works outside the Windows sandbox. See root `AGENTS.md` and the
[CLI workflow](../github.md). The application handoff above remains dated 2026-11-13.
