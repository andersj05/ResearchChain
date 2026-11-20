# Adaptive research teams

On 2026-11-20 the owner asked to start financial research with a brief and an
example report, give agents freedom to investigate, and follow their work while
it happens. The graph editor remains available for experiments that need an
explicit sequence.

## Execution

A research session pins its brief, chosen evidence, model, account, team size,
tool permissions, pass limits, active time and review policy before execution.
A lead reads the brief and proposes between one and the owner's maximum number
of assignments. The worker records that plan before it starts a researcher.
Each assignment gets a stable position in the plan, a separate Codex session
and its own Python workspace. Researchers can pursue leads, revise analyses,
record sources and export files. Their choices do not edit the saved workflow.

The existing LangGraph run owns cancellation, checkpoints and recovery. Each
provider request uses the existing admission and receipt journal. Parallel
research shares the run's request and active-time budgets. A fixed token limit
requires the previous request's returned usage before the next admission.
Stored plans and completed requests can be replayed. An uncertain provider
request stops recovery for inspection.

## Judgment and writing

The owner can ask to review every study before writing, review when the team
raises a question, or let the editor proceed. A review carries the actual
question and the owner's recorded answer into the editor's request. The editor
receives the researchers' findings and files through the pinned connection
to the team. File names identify their researcher so that two charts with the
same original name remain distinguishable. A writing example is supplied only
to the editor as style material. Evidence and provider observations retain
their own identities.

The owner can send direction before the editor's first request is reserved.
The worker includes accepted notes when preparing subsequent requests and records
their IDs on each attempt. Requests already sent keep the inputs they received.
An editor finishes by saving a nonempty `report.md` or returning the complete
Markdown for the worker to save. The export resolves figures against the files
recorded with that editor's work.

## Workbench

The first screen is a brief and recent studies. The session view shows the
assignments, current recorded activity, saved passes, owner decisions and
resulting report. Selecting a researcher opens its workspace. The detailed
workflow inspector remains reachable from the session, and older deep links
continue to open their existing destinations.

Implementation is delivered in two increments. The first adds the executable
team, handoff and session API. The second makes that path the Desktop entry and
verifies the complete research and revision journey. Acceptance is tracked in
[issue 129](https://github.com/andersj05/ResearchChain/issues/129).
