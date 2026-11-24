# Research interface principles

The owner asked on 2026-11-17 to use these essays as expert judgment for ResearchChain.

- Routine work becomes easier to delegate when the objective and success conditions
  can be stated clearly. Redesign the research process around that division of work.
  Give agents repeatable collection, cleaning, calculations, and consistency checks.
  Keep the owner in control of the question, the trade-off, and the decision to pursue
  a view. [Visions of the Future](https://equitycats.substack.com/p/visions-of-the-future).
- The interface should make agent work legible and bring the consequential choices
  to the expert. Research should take and defend a view. A review should show the
  proposed view, the best contrary evidence, and what a decision will change.
  [Interfaces, Brains, and Computers](https://equitycats.substack.com/p/interfaces-brains-and-computers).

## Apply this to ResearchChain

- **See progress.** Answer what is running, what it produced, and where it stopped
  from the run itself. Keep the actual model, usage, sources, and saved calculations
  accessible next to the work they support. Preserve an explicit unknown when an
  attempt or usage metric is unreported.
- **Ask for a decision.** A checkpoint should ask a specific question and show the
  evidence needed to answer it. In macro research that might be the plausible policy
  path, the risk already reflected in prices, or the catalyst that would change the
  view. Save the owner's rationale and wire it into subsequent work.
- **Make the view testable.** Date the market setup, state the horizon, give the
  transmission mechanism, distinguish market-implied expectations from estimates,
  and state what would invalidate the thesis. Attach the data, methodology, and
  chart when the evidence permits a calculation.
- **Make iteration affordable.** Expose the settings and inputs a researcher would
  change in a second experiment. Keep a run's workflow and decisions inspectable
  after later edits so the owner can trace changes in the research.
- **Test the operator's path.** On an example run, locate the active or failed step,
  inspect the evidence behind a proposal, record a decision, and find its influence
  downstream. Use those tasks to judge whether new controls earn their place.

These are product choices derived from the essays. The project's existing evidence,
provider, and run-isolation rules govern implementation.

## Make the research plan inspectable in Build

Show which inputs can reach a step under the current control connections and
where an expert’s feedback will go. Make both visible while the owner is still
editing the plan. Treat a change in the research question, model, or evidence
path as part of the experiment and expose it before the draft is saved.
Compare the draft with an exact saved version. Keep the draft available while
the researcher reads the difference and opens the affected step. Show step
names and identifiers together when two paths could be mistaken for each other.
Inspect a review as a decision in the workflow. Follow the preceding control
step to check how the proposal and contrary evidence are prepared, then follow
the review’s feedback to see which later inputs or conditions use the answer.

Put the connected outline before step insertion in Build. Show parallel and
conditional branches in their named groups and keep the paired join in the
main sequence. Expand a loop or subgraph by its caller to browse the pinned
body. The canvas and inspector follow an outline selection. Keep unresolved
steps available when a draft’s control connections change.
[Figma Layers and navigation](https://help.figma.com/hc/en-us/articles/360039831974-Explore-the-navigation-bar-and-left-sidebar).

Give long workflows a Plan view that keeps the root outline visible while the
researcher reads a nested step. Keep the same selection when switching to Canvas
to inspect or reconnect its edges.
[Figma UI3 design retrospective](https://www.figma.com/blog/our-approach-to-designing-ui3/).

Put the previous iteration’s output beside the step input that uses it. Show the
initial value and link to the editable source. During a run, use the same binding
to reach the producing occurrence and its saved result. For reviewer feedback,
show the next recipient when there is a possible follow-up.
[Figma component properties](https://help.figma.com/hc/en-us/articles/5579474826519-Explore-component-properties) ·
[Vercel Workflow observability](https://vercel.com/academy/workflow-foundations/observe-everything).

## Run inspection references

- Vercel’s workflow inspector keeps the recorded timeline, waits, step inputs,
  and outputs together. Give ResearchChain an index of saved outputs, with a
  link to the exact step occurrence and recorded model pass. Keep a pending
  decision accessible while the researcher looks back at earlier work.
  [Vercel Workflow observability](https://vercel.com/academy/workflow-foundations/observe-everything).
- For a repeated research step, compare two saved outputs where one loop
  iteration changes. Show each side’s conclusion, exact request and recorded
  URLs. A pair should reopen the same records while the run remains available.
  Start with the map collapsed in Outputs to give the recorded results room.
- Braintrust uses an ordered trace and shared time axis to expose overlap, retries,
  and gaps. ResearchChain should show the latest recorded activity while a researcher
  reads an earlier output, and use recorded durations when accounting for latency.
  [Braintrust trace design](https://www.braintrust.dev/articles/what-does-a-good-ai-agent-trace-look-like).
- Temporal separates history for an individual execution from the list used to find
  executions that need attention. ResearchChain should surface the pending decision
  in run discovery while keeping the pinned review and supporting evidence in the run.
  [Temporal visibility](https://docs.temporal.io/visibility).
- LangSmith compares results on controlled inputs. ResearchChain's first comparisons
  should expose differences in briefs, evidence, settings, and reviewer feedback so
  the owner can judge whether the experiment is comparable.
  [LangSmith evaluation types](https://docs.langchain.com/langsmith/evaluation-types).
