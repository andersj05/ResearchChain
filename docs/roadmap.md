# Roadmap

GitHub issues and the Project track status. This document explains sequencing.

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
