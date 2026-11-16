# Roadmap

GitHub issues and PRs track status. This document explains sequencing.

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

The milestones below describe the broader product roadmap. Human quality studies
and remote hosting follow the local environment handoff; they do not block it.

| Milestone                | Deliverable                                                            | Exit criteria                                                           |
| ------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| M0 Foundation            | Repo, UI SDK editor slice, LangGraph, contracts, CI, memory            | Clean setup and edit → validate → run → review → resume test            |
| M1 Durable workflows     | Postgres, revisions, events, cancellation, bounded loops and subgraphs | Interrupted runs survive restart; runs preserve their original versions |
| M2 Evidence and research | Source ingestion, charts, hypothesis ledger, model/tool adapters       | Claims trace to sources and as-of dates; hypotheses can be challenged   |
| M3 Editorial evaluation  | Report editor, style exemplars, annotation, blind A/B evaluation       | Reproducible evidence-fixed and end-to-end evaluations with holdouts    |

## Quality loop

Use the anchor EquityCats article as a development exemplar. Build separate
held-out topics and time periods. Keep reference reports out of generation inputs
for evaluations that claim independent reproduction. Historical tests require
as-of source snapshots and data vintages; live browsing can leak future information.

Evaluate factual and numeric correctness as gates, then analytical depth, causal
mechanisms, disconfirming evidence, useful scenarios, clarity, voice, and editing
effort. Record pairwise human preferences alongside reasons and changed spans.
Use a fast frozen-evidence writing loop and a slower complete-research loop.

Do not optimize only an LLM judge or resemblance score. Keep test sets separate,
calibrate judges against human feedback, and log the workflow/prompt/model/data
versions for every comparison. Prompt optimization or fine-tuning comes after a
reliable dataset and baseline, not before.
