# Project context

Confirmed with the owner, 2026-11-13.

- Publication: [EquityCats](https://equitycats.substack.com/).
- Anchor example: [Mixed Signals, Rotations and Correlations](https://equitycats.substack.com/p/mixed-signals-rotations-and-correlations).
  The owner identifies it as the strongest example and says it was well received
  by fund managers. This is an owner report, not an independently verified outcome.
- Start from ideas, charts, reports, and discussions on X. Research is iterative:
  connect evidence, test hypotheses, seek disconfirming views, and revisit premises.
- Aim for detailed reports in the owner's voice, with substantial human feedback.
- The UI must ultimately edit nodes, edges, subgraphs, prompts, tools, routing,
  checkpoints, and evaluation settings. The custom UI is a firm decision.
- Use UI SDK (`ui-sdk.dev`); Next.js is the selected frontend foundation.
- Use LangGraph for orchestration. Do not lock the system to a single model vendor.
- Branch structure is `main` → `dev` → `feat/<feature-name>`.
- Prioritize short, reproducible iteration loops with meaningful quality checks.

The anchor report can guide development but cannot also be an uncontaminated
holdout. Writing resemblance alone is not a measure of research quality.
