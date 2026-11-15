# ResearchChain

A customizable research workbench for EquityCats: develop hypotheses, inspect evidence,
challenge conclusions, and write reports with human editorial judgment in the loop.

## Development

The foundation uses Next.js + TypeScript + UI SDK for the editor, and Python +
LangGraph + FastAPI for execution, with Postgres revisions and checkpoints. Runs
survive API restarts and stay pinned to their original workflow. The default example remains a deterministic exercise. The
[research template](docs/hypothesis-research.md) uses the connected ChatGPT plan to
form, challenge, and revise hypotheses against captured evidence, with human review.

The [evidence desk](docs/evidence-desk.md) captures permitted originals, tracks
source provenance and claim relationships, and pins evidence versions to runs.

Setup and commands: [development guide](docs/development.md).
Track work in [issues](https://github.com/andersj05/ResearchChain/issues) and
[PRs](https://github.com/andersj05/ResearchChain/pulls) through the GitHub CLI (`gh`).
See the [CLI workflow and repository configuration](docs/github.md).

## How we work

- `main` is the stable branch; `dev` integrates work.
- Create `feat/<feature-name>` from `dev`, open its PR into `dev`, then promote
  `dev` into `main` with a merge commit. Do not squash the long-lived `dev` branch.
- Keep commits small and meaningful. CI checks the branch route and application.
- Start agents with [AGENTS.md](AGENTS.md). Project context and current state live
  in [docs/memory](docs/memory/README.md); decisions live in [docs/decisions](docs/decisions/0001-foundation.md).

## Project map

| Location             | Purpose                                                               |
| -------------------- | --------------------------------------------------------------------- |
| `apps/web`           | Custom Next.js workbench and UI SDK canvas adapter                    |
| `apps/api`           | Workflow validation, LangGraph compiler, and local API                |
| `packages/contracts` | Generated API schema and TypeScript types                             |
| `examples`           | Synthetic, shareable workflow fixtures                                |
| `docs`               | Architecture, development, evaluation plan, and durable agent context |
| `.github`            | CI, contribution templates, and dependency updates                    |

See the [architecture](docs/architecture.md), [roadmap](docs/roadmap.md), and
[research behind the choices](docs/research/2026-11-13-foundation.md).

This repository is public. Keep credentials, private source reports, paid research,
personal notes, and run artifacts out of Git. There is currently no project license;
adding one is an explicit owner decision.
