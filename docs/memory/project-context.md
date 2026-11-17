# Project context

Confirmed with the owner, 2026-11-13; scope clarified 2026-11-16.

## First implementation pass: owner-built agents

Confirmed with the owner on 2026-11-16. Deliver the local environment in which the
owner designs, runs, inspects and iterates on their own agent. The owner determines
the research strategy, prompts, sources, checkpoints and quality judgments.
Agent-generated research templates and pilots are optional examples, not the product
specification or acceptance gates. Do not require pilot labels, a calibrated judge,
a finished agent, public hosting or publication to complete this environment pass.

Acceptance: the owner can start a blank workflow, configure model instructions and
human reviews, wire inputs, choose evidence/model/limits, save versions, run and inspect
outputs, incorporate feedback, and start a revised experiment without editing code.
Verify with synthetic providers; do not consume the owner's plan or submit human
judgments to demonstrate readiness. After delivery, the owner will build a simple
agent and supply usability feedback. Preserve that as the next step.

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
- Keep the interface simple and visually close to Vercel: Geist typography,
  neutral surfaces, thin borders, and restrained status colors (2026-11-13).
- The owner requested a substantial composition redesign: flat, modern enterprise
  UI, intuitive task flows, and selective playful color (2026-11-14). Follow the
  audited patterns and project conventions in [design.md](../design.md).
- Visual refinement (2026-11-14): square corners throughout; remove decorative
  graphics and redundant icons. Favor explicit labels and predictable editing.
- Use LangGraph for orchestration. Do not lock the system to a single model vendor.
- Provider choice (2026-11-14): use the owner's ChatGPT Pro included allowance via
  the official local-app Sign in with ChatGPT flow. No paid API fallback.
- Branch structure is `main` → `dev` → `feat/<feature-name>`.
- Prioritize short, reproducible iteration loops with meaningful quality checks.
- Track development through GitHub issues and PRs using `gh`; no GitHub Projects
  or browser-based GitHub workflow. Minimize tracking overhead (owner, 2026-11-14).

The anchor report can guide development but cannot also be an uncontaminated
holdout. Writing resemblance alone is not a measure of research quality.
