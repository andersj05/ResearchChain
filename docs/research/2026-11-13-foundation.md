# Foundation research

Checked 2026-11-13 against primary documentation and package metadata.

- [UI SDK](https://ui-sdk.dev/docs/react/installation) installs both `@ui-sdk/react`
  and `@ui-sdk/core`, requires React 19+, and provides unstyled primitives. The
  npm release inspected is `0.1.0-beta.1`; isolate and pin the beta dependency.
- [Canvas behaviors](https://ui-sdk.dev/docs/core/behaviors/canvas) supply viewport
  and connection behaviors. The application still owns graph state, validation,
  rendering, keyboard paths, undo, and serialization.
- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
  supports Windows and App Router. Lint is a separate CI command; a production
  build alone does not check it. We use a client boundary for the interactive editor.
- [LangGraph overview](https://docs.langchain.com/oss/python/langgraph/overview)
  supports deterministic and model-driven steps. It does not require a model or
  hosted LangSmith to run a development workflow.
- [Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts) use a
  checkpointer and thread identity. Nodes restart on resume; keep effects outside
  replayed pre-interrupt code or make them idempotent.
- [React Flow](https://reactflow.dev/learn) is a credible canvas fallback. Prefer
  switching a local adapter over rebuilding the workflow representation if needed.
- [uv locking](https://docs.astral.sh/uv/concepts/projects/sync/) makes Python
  dependencies reproducible. CI uses locked installs, as does pnpm for JavaScript.
- [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
  support PR/check requirements and prevention of deletion and force pushes. Avoid
  requiring another approver while the repository has a single maintainer.
- [Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md) provides
  hierarchical instructions. Keep the root concise and point to task-relevant
  context; ordinary memory files must be explicitly read and maintained.

Next.js versus Vite and Python versus TypeScript runtime are engineering judgments
for this project, not performance claims from these sources. A comparative load
test is still needed before selecting production scaling infrastructure.
