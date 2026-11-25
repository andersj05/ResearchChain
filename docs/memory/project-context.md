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
- The owner adopted the two EquityCats essays as product design input on 2026-11-17.
  Apply the [research interface principles](../research-interface.md) when designing
  run inspection, workflow customization, and review checkpoints.
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

On 2026-11-24 the owner specified a source-only entry for the Research desk.
A week of charts, notes and conversations precedes the working sentence. Batch
intake, visible settings and a methodology graph should make the handoffs and
owner decisions legible. A lead should delegate parallel assignments, each
researcher should have its own workspace, and the owner should be able to see
ongoing work, supply judgment and read a report with its charts.
See [adaptive research teams](../decisions/0023-adaptive-research-teams.md).

The owner also wants several Astra leads to delegate simpler investigations
to Sol researchers. A lead can bring a trade idea and alternatives to the
owner for judgment, then use the answer to revise its investigation before
the report is written. [Research swarms](../decisions/0024-research-swarms.md).

On 2026-11-25 the owner chose Research Swarm for new Research Desk studies.
Use GPT-6.2 Astra for leads and the report writer, GPT-6.2 Sol for researchers,
and High thinking effort and response detail with sliders. Enable web search
and expert consultation by default. Let assignments finish when their work is
ready. The owner wants to see the live team and its files, steer the work or
send findings to the editor, and resume eligible failures on the same study.
[Live Research Swarm studies](../decisions/0027-live-research-swarm.md)
