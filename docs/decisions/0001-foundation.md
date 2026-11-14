# ADR 0001: Custom editor with a separate LangGraph runtime

Date: 2026-11-13. Status: accepted for the foundation.

## Context

The owner requires visual editing of a complex, iterative research process and
selected UI SDK. Research runs may be long-lived and pause for human judgment.

## Decision

Use a pnpm monorepo with Next.js App Router, React, TypeScript, and UI SDK. Keep a
Python FastAPI + LangGraph service in `apps/api`, managed by uv. Use a versioned
JSON workflow representation; Python validation models generate OpenAPI and
TypeScript client types. The backend always validates graph semantics before
compilation. Editor layout is data, not executable code.

Start with a narrow deterministic workflow to verify editing, execution, and
human review. Unsupported graph features fail validation until implemented. Pin
the UI SDK beta and wrap its canvas behaviors in a local adapter. Keep workflow
semantics independent of this UI dependency.

## Alternatives and tradeoffs

| Option                         | Benefits                                                                                     | Costs / why not selected now                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Next.js + Python               | Strong React UI ecosystem and Python research tooling; separate runtime scales independently | Two languages and an API boundary; generated contracts and CI control drift                                            |
| Vite SPA + Python              | Smaller frontend deployment and simpler static hosting                                       | Future authenticated workspace and server-side integration routes require more assembly; revisit if Next adds no value |
| Next.js + TypeScript LangGraph | One language, easier shared types                                                            | Python is useful for data analysis and chart reproduction; do not duplicate runtime implementations                    |
| React Flow canvas              | Mature graph editing, handles, selection, subflows                                           | Adds a second interaction system; retain as a fallback if measured UI SDK editor work dominates product delivery       |
| UI SDK custom canvas           | Full markup/interaction ownership, aligned with user choice                                  | Beta API and more responsibility for keyboard access, connections, layout, undo, and performance                       |

No Redis, vector database, Kubernetes, distributed task queue, or multi-agent swarm
is required to validate this slice. Add Postgres checkpoints and artifact storage
before real long-lived research or shared hosting. A canvas is a workflow editor;
it is not itself an execution engine.
