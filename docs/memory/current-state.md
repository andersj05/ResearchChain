# Current state

Updated 2026-11-18. The owner requested better visibility into model runs, more
control over workflow iteration, and an editable discretionary macro agent.
[Delivery criteria](https://github.com/andersj05/ResearchChain/issues/66).

## Compare web sources recorded on selected passes

**Recorded web sources** groups the shared URLs and sources recorded on only
one selected pass. It updates when the pass changes and flags missing or
incomplete records. The phone comparison test verified the source groups and
earlier pass selection. CI passed 519 backend tests with 2 skips and all 123
browser cases. Desktop at `e4ffa16` served the controls with the API and worker
ready.
[PR #105](https://github.com/andersj05/ResearchChain/pull/105).

## Keep the baseline attached to an experiment

**Iterate** keeps the original run as a baseline through draft reload and start
retry. Run setup shows the baseline and lets the owner clear it. **Compare with
baseline** reopens that exact pair from the revised run. The backend validates
the shared agent on admission and preserves the revised run if retention later
removes its baseline. CI passed 519 backend tests with 2 skips and all 123
browser cases. Desktop at `91a2d64` restored and migrated a private rehearsal,
then verified the live migration preserved saved data and the app restarted.
[PR #104](https://github.com/andersj05/ResearchChain/pull/104).

## Follow the bindings behind a saved step

**Data bindings** shows the saved step’s upstream sources and where its output
goes. Each link opens the attached step in the same pinned graph and iteration.
The synthetic macro test followed a binding from the discriminating test to the
challenge step and back, then returned to the pending decision. CI passed 517
backend tests with 2 skips and all 123 browser cases. Desktop at `3c5f5db`
served the new controls with a healthy API and connected worker.
[PR #103](https://github.com/andersj05/ResearchChain/pull/103).

## Compare the saved model passes you choose

Run comparison lets you choose a saved conclusion, research lead, or
workspace action independently on each side. A copied pass comparison link
reopens the same saved pair and step. The phone browser test verified an
earlier workspace pass, its exact model request, and an unavailable pass link.
CI passed 517 backend tests with 2 skips and all 123 browser cases. Desktop at
`bd5b558` served the comparison controls with a healthy API and connected
worker. The owner-gated read-only checks also passed.
[PR #102](https://github.com/andersj05/ResearchChain/pull/102).

## Search Recent runs by their saved brief

Recent runs shows a brief excerpt and includes it in the filter. The full
archive still searches the complete brief. The first CI run exposed a race
where a submitted review’s history refresh reset the inspection panel. The
macro test now delays that response and verifies that Decisions and its
saved request links stay open. CI passed 517 backend tests with 2 skips and
all 123 browser cases on the corrected commit. Desktop at `85a8043` served
the new list with a healthy API and connected worker. The owner-gated recent
run route and read-only brief query passed.
[PR #101](https://github.com/andersj05/ResearchChain/pull/101).

## Recover workspace startup and preserve drafts

A transient local API failure during workspace startup retries the affected
read once. The requested view still opens, and a failed read for a named agent
preserves its saved browser draft. Browser tests verified the recovered
revision and draft, and exercised the mobile review inbox and saved run links.
CI passed 517 backend tests with 2 skips and all 123 browser cases. Desktop at
`1f6481e` opened Reports after a simulated gateway failure with every API
response mocked and writes blocked. API health, worker connection, and the
owner-gated read-only checks also passed.
[PR #100](https://github.com/andersj05/ResearchChain/pull/100).

## Compare runs directly and retain inspection filters

**Runs → Compare runs** opens setup, output, and file comparisons directly.
Archived baseline search and copied links still select the exact pair.
Model activity and Files retain their filters when you open a saved attempt
and return. The fitted timeline range also persists within the open run. CI
passed 517 backend tests with 2 skips and all 121 browser cases. Desktop at
`11c320f` served the view with a healthy API and connected worker.
Read-only checks passed for evidence search, run archive and review inbox.
[PR #99](https://github.com/andersj05/ResearchChain/pull/99).

## Duplicate configured research steps

**Duplicate research step** in Build inserts a copy with the same instructions,
model, tools, and input bindings and focuses its name. The browser test verified
Undo and the exact saved copy, original step, and successor connections. CI
passed 517 backend tests with 2 skips and 121 browser cases, including one
access test that passed on retry. Desktop at `50ee743` served the control with
a healthy API and connected worker. Read-only evidence search, run archive
and review inbox checks passed. [PR #98](https://github.com/andersj05/ResearchChain/pull/98).

## Save a web reference from an attempt

**Web sources → Save source link** lets the owner review the title and URL
before adding a Link only record to Sources. The record includes the provider
observation time and exact run and attempt IDs. The phone test verified that
retrying an interrupted response returns the record already created. CI passed
517 backend tests with 2 skips and all 120 browser tests. Desktop at `25e2bd5`
served the controls with a healthy API and connected worker. Read-only checks
passed for evidence search, run archive and review inbox.
[PR #97](https://github.com/andersj05/ResearchChain/pull/97).

## Combine recorded judgments

**Runs → Decisions → Combine feedback for next run** stages several judgments
in the recorded order. The preview shows the exact brief and identifies the
source run and checkpoint for each entry. Shorten the prior brief or deselect
an entry if the result exceeds the run brief limit. Build opens the saved
workflow with the revised brief and original evidence selections. CI passed
517 backend tests with 2 skips and all 120 browser tests. Desktop at `0055410`
served the controls with a healthy API and connected worker. Read-only checks
passed for evidence search, run archive and review inbox.
[PR #96](https://github.com/andersj05/ResearchChain/pull/96).

## Inspect saved inputs and iterate from a step

**Inspect saved inputs** shows the text supplied for a recorded model attempt,
including prior conclusions, selected evidence, and reviewer feedback. The
comparison view can open each request independently. **Iterate from this step**
opens the exact saved step in Build. **Timeline range** fits filtered attempts
on request. CI passed 517 backend tests with 2 skips and all 120 browser tests.
Desktop at `0794cd7` served the controls with a healthy API and connected
worker. Read-only checks passed for evidence search, run archive and review
inbox. [PR #95](https://github.com/andersj05/ResearchChain/pull/95).

## Search and verify saved evidence

**Sources** searches the entire library and applies availability before paging.
Filtering keeps the open source and its claims visible. **Pinned evidence**
shows saved dates and uses the research manifest when a source cannot load.
**Pinned source order** shows both full sequences when shared evidence moved.
CI passed 517 backend tests with 2 skips and all 120 browser tests on retry
after the first runner timed out. Desktop at `d31061e` served the controls with a
healthy API and connected worker. The owner-gated search and read-only query
passed on Desktop. [PR #94](https://github.com/andersj05/ResearchChain/pull/94).

## Prepare evidence in Run setup

**Evidence for this run** searches the full library by title, author, publisher,
or saved date. **Selected sources** shows exact versions in the order they will
be pinned. Inspect, move, remove, or retry individual source details while
browsing. The phone-width tests verified keyboard focus, saved order, older
provenance after correction, and protection from a delayed search response. CI
passed 517 backend tests with 2 skips and all 119 browser tests. Desktop at
`ca73827` served the controls with a healthy API and connected worker. The
owner-gated search route and a read-only library query passed on Desktop.
[PR #93](https://github.com/andersj05/ResearchChain/pull/93).

## Review inbox agent filter

**Review inbox → Show reviews for** switches between all agents and the active
agent. The phone-width test verified filtering before pagination, restoring the
full queue, and opening the exact review from a parallel branch. CI passed 516
backend tests with 2 skips and all 119 browser tests. Desktop at `9e30067` served
the filter with a healthy API and connected worker.
[PR #92](https://github.com/andersj05/ResearchChain/pull/92).

## Model activity timeline

**Model activity → Timeline** shows the recorded overlap and gaps between model
attempts. A hollow point marks a start with an unreported duration. The
phone-width test verified overlap, a measured zero, the fixed axis through
filtering, display preference restoration, and exact attempt links. CI passed
516 backend tests with 2 skips and all 119 browser tests. Desktop at `67cc28a`
served the timeline with a healthy API and connected worker.
[PR #91](https://github.com/andersj05/ResearchChain/pull/91).

## Run limits in setup

**Run workflow → Run limits** shows and edits execution, request, and evidence
limits in the draft. The synthetic check pinned 270 active seconds, verified a
zero-attempt run, and reopened a collapsed section with an invalid value. CI
passed 516 backend tests with 2 skips and all 119 browser tests. Desktop at
`172778e` served the controls with a healthy API and connected worker.
[PR #90](https://github.com/andersj05/ResearchChain/pull/90).

## Compare matching model outputs

**Runs → Run context → Compare a saved run → Model outputs by step** pairs the
latest saved conclusions at the same step and loop iteration. It shows when only
one run has an output and links to the exact producing attempts. The phone-width
test compared a shared iteration and two steps with output on one side. CI passed
516 backend tests with 2 skips and all 119 browser tests. Desktop at `2b58e37`
served the comparison with a healthy API and connected worker.
[PR #89](https://github.com/andersj05/ResearchChain/pull/89).

## Step models in Run setup

**Run workflow → Step models** edits model assignments for the reachable
research steps, including versioned subgraphs. An unavailable override can be
replaced or cleared in setup. The synthetic checks verified the requested model
on the new run and preserved an unused subgraph version when clearing overrides.
CI passed 516 backend tests with 2 skips and all 119 browser tests. Desktop at
`253bcf5` served the controls with a healthy API and connected worker.
[PR #88](https://github.com/andersj05/ResearchChain/pull/88).

## Workspace files at a review checkpoint

**Files for this review** shows saved files from the work under review and the
earlier steps that supplied its context. The phone-width macro test opened a CSV,
kept its draft judgment, and verified that the saved judgment reached the
downstream model request. CI passed 516 backend tests with 2 skips and all 118
browser tests. Desktop at `58adbc6` served the controls with a healthy API and
connected worker. [PR #87](https://github.com/andersj05/ResearchChain/pull/87).

## Saved CSV table previews

Open a saved CSV from **Runs → Files** or **Output file changes** to read its
headers and first 50 rows and 20 columns. **Show raw CSV** displays the original
text, and download returns the full file. Synthetic checks covered quoted commas,
line breaks, leading zeros, clipping, and phone-width scrolling. CI passed 516
backend tests with 2 skips. Of 118 browser cases, 117 passed on the first attempt
and the expired-session case passed on retry. Desktop at `68cfb4d` served the
table control with a healthy API and connected worker.
[PR #86](https://github.com/andersj05/ResearchChain/pull/86).

## Review drafts in the current tab

Unsent reviewer feedback stays with its run and interrupt across run switches and
refreshes in the same tab. The phone-width check proved two independent drafts,
pruning one after its decision, and cleanup after cancellation. Full CI passed
516 backend tests with 2 skips and 118 browser tests. Desktop at `4d6c85d`
served the draft handling with a healthy API and connected worker.
[PR #85](https://github.com/andersj05/ResearchChain/pull/85).

## Exact model attempt links

**Attempt details → Copy attempt link** reopens the specific saved model pass.
The phone-width check copied and reopened an earlier pass of the same step while
the latest workflow activity remained visible. CI passed 516 backend tests with
2 skips and 118 browser tests. Desktop at `3806710` served the control with a
healthy API and connected worker.
[PR #84](https://github.com/andersj05/ResearchChain/pull/84).

## Saved output comparisons

**Run context → Compare a saved run → Output file changes** pairs the last
recorded file for each step path and filename. Preview or download either version
and see its producing pass. The browser check covered two different CSVs, a
removed file, and a file that reverted to identical bytes. CI passed 516 backend
tests with 2 skips and 118 browser tests. Desktop at `2c1c8b5` served the controls
with a healthy API and connected worker.
[PR #83](https://github.com/andersj05/ResearchChain/pull/83).

## Inline workspace file previews

**Runs → Files → Preview** opens a saved chart or supported text file directly
in the list. The phone-width check decoded the chart and opened two separate
versions of the same script. CI passed 516 backend tests with 2 skips and 118
browser tests. Desktop at `382245c` served the previews with a healthy API and
connected worker. [PR #82](https://github.com/andersj05/ResearchChain/pull/82).

## Comparison links

**Copy comparison link** bookmarks both run IDs. Opening it restores the exact
pair in Run context, including a baseline from the archive. The phone-width
browser check covered older runs, panel switching, and rejecting cross-agent
pairs. Full CI passed 516 backend tests with 2 skips and 118 browser tests.
Desktop at `6fdaade` served the control with a healthy API and connected worker.
[PR #81](https://github.com/andersj05/ResearchChain/pull/81).

## Model activity ordering

**Runs → Model activity** sorts attempts by time, elapsed duration, or complete
reported token totals. Attempts with missing measurements follow measured rows.
The phone-width browser check covered measured zero and preference restoration
after reload. Full CI passed 516 backend tests with 2 skips and 118 browser tests.
Desktop at `f3a2438` served the controls with a healthy API and connected worker.
[PR #80](https://github.com/andersj05/ResearchChain/pull/80).

## Saved workspace files across a run

**Runs → Files** finds saved charts, scripts, and methods files by filename, type,
or step. It links to the exact producing model pass and download. The 390 px
browser check verified separate downloads for two versions of a script and one
entry for an unchanged chart. CI passed 516 backend tests with 2 skips and 117
browser tests. Desktop at `4d0683f` served the Files view with a healthy API and
connected worker. [PR #79](https://github.com/andersj05/ResearchChain/pull/79).

## Saved run archive

**Runs → Search saved runs** searches the archive by brief, agent, workflow, or
run ID. The comparison picker searches the open run's agent scope. The synthetic
phone-width browser check found and compared a run outside the latest 20, then
opened it from page two. Full CI passed 516 backend tests with 2 skips and 117
browser tests. Desktop at `d1ec286` served the archive and verified the owner
gate, read-only cursor query, and connected worker.
[PR #78](https://github.com/andersj05/ResearchChain/pull/78).

## Downstream use of recorded judgments

**Runs → Decisions → Steps wired to this feedback** lists direct recipients and
opens the most recent saved model request for the exact step and iteration. The
synthetic macro test verified the request contains the recorded judgment. Full CI
passed 515 backend tests with 2 skips and 116 browser tests. Desktop at `f8a79e7`
served the links with a healthy API and connected worker.
[PR #77](https://github.com/andersj05/ResearchChain/pull/77).

## Pinned setup comparison

**Runs → Run context → Compare a saved run → Setup changes** shows before and
after values for the brief, models, limits, pinned inputs, workflow wiring, and
recorded judgments. It follows versioned subgraphs and ignores canvas positioning.
The synthetic comparison verified a changed model, source order, and nested
review question. Full CI passed 515 backend tests with 2 skips and 116 browser
tests. Desktop at `686b8a3` served the comparison with a healthy API and connected
worker. [PR #75](https://github.com/andersj05/ResearchChain/pull/75).

## Workflow step search

**Build → Find a step** searches names, instructions, and assigned models across
the draft and its referenced subgraphs. Selecting a result focuses the step editor.
Browser checks covered nested navigation, phone widths, and all 128 matches in a
large workflow. Desktop at `8758ba5` served the finder and review inbox with a
healthy API and connected worker. [PR #73](https://github.com/andersj05/ResearchChain/pull/73).

## Review inbox

**Runs → Review inbox** lists pending questions across agents, including runs
older than the recent history. It checks both checkpoint and interrupt identity
when opening a review. Browser checks covered parallel questions, draft feedback,
and a cancelled run. A synthetic check found an open question behind 20 later
completed runs. Desktop at `b8f09d3` served the inbox, required owner access for
its API, and read the pending-review query successfully with a connected worker.
[PR #72](https://github.com/andersj05/ResearchChain/pull/72).

## Run comparison and live progress

Desktop at `c45ce60` served same-agent run comparison, the saved workflow map
preference, and latest activity while reading older outputs. The API was healthy,
the worker connected, and the saved macro agent was present.
[PR #70](https://github.com/andersj05/ResearchChain/pull/70).

## Discretionary macro and decisions

The [editable discretionary macro starter](../discretionary-macro-example.md) has
ten steps. It frames a cross-asset tension, estimates what markets price, tests
competing mechanisms in the Python workspace, challenges the thesis, and drafts
scenarios and a memo. The owner chooses the scope, weighs the dissent, and
decides whether the view is ready. **Runs → Decisions** shows open reviews and
recorded judgments. A selected judgment can be appended to a fresh editable brief.

[PR #68](https://github.com/andersj05/ResearchChain/pull/68) passed full CI and browser
checks. The synthetic browser run confirmed the saved feedback in downstream model
requests and completed all three checkpoints. Desktop at `5af9c3a` served the macro
starter and decision controls, the API was healthy, and the worker reconnected.
An editable version 1 macro agent was saved locally. A separate synthetic run of
that graph used the local Python runner and saved a chart, CSV, and methods note.
The owner can try a real question and judge whether the checkpoints ask for the
decisions that matter.

## Model activity and interface guidance

**Runs → Model activity** lists attempts across the pinned workflow. Filter by step,
model, or status and open a pass directly. The workflow map can be hidden to give
the reader more space. The [research interface principles](../research-interface.md)
record the product choices taken from the owner's two EquityCats essays.
[PR #67](https://github.com/andersj05/ResearchChain/pull/67) passed the full CI and
browser gate. Desktop at `920b77d` served the new controls, the proxied API reported
healthy, and the worker reconnected with an idle queue.

## Python research workspaces

The builder offers an opt-in research workspace with owner-set pass and execution
limits. Codex can use hosted search, write and run Python, read the numerical
output and inspect its chart on the next pass. Each action retains its script
and exports. The run graph shows activity, charts, datasets and full Markdown
reports. A synthetic run through the installed Codex CLI and local Docker image
reached the demo's final review with a saved chart, script and report. Recovery
tests replayed a confirmed action before the next calculation.
[Delivery criteria](https://github.com/andersj05/ResearchChain/issues/64).

The owner's next step is to try the [idea generation demo](../idea-generation-demo.md)
with the synthetic rotation brief or a real question and give feedback on the
research and review experience. [Workspace architecture](../decisions/0022-research-python-workspaces.md).

## Research run workbench

New research workflows default to one million cumulative tokens. Run setup can
pin a larger fixed total or **As needed** for a fresh experiment. The inspector
uses the pinned graph, shows the stopped step when a checkpoint records an error
and keeps earlier decisions and pass-level source receipts accessible. The
Idea Research example enables an editable, multi-pass Codex analyst after the
direction checkpoint. [Owner guide](../idea-research-example.md).

The analyst needs the local Codex executable on the worker PATH. On 2026-11-17
the Desktop installation moved to `dev` and took schema 13 after a verified
backup restore and migration rehearsal. The live web and API checks passed,
the worker connected, and the served app included the review navigation, analyst
settings and token-budget controls from [PR #62](https://github.com/andersj05/ResearchChain/pull/62).
The owner's next step is to try the revised example or adjust a saved agent
and assess the resulting research.

## Scope and next step

The first implementation pass delivers the local environment for the owner to
design, run, inspect and iterate on their own agent. The owner determines strategy,
prompts, sources, checkpoints and quality judgments. Templates and saved pilots are
optional examples. A finished agent, pilot labels, a calibrated judge and public
hosting are not acceptance gates for this environment.

The owner tested the idea-research example and requested easier reading, model
selection in the graph, financial research during framing, and a quieter canvas.
The [example guide](../idea-research-example.md) describes the updated workflow.

- [Model selection](https://github.com/andersj05/ResearchChain/pull/54) adds a workflow default above the canvas and a model override in the step inspector.
- [Run reader](https://github.com/andersj05/ResearchChain/pull/55) renders Markdown, opens the latest output and keeps earlier steps and their source records available.
- [Graph interactions](https://github.com/andersj05/ResearchChain/pull/56) restore complete card borders, highlight connected paths and give the canvas the space previously used by the persistent footer.
- [Research tools](https://github.com/andersj05/ResearchChain/pull/57) give the editable framing step optional web and market search. The later research step can request annual SEC financials with filing provenance. Direct SEC retrieval requires the worker's configured operator contact.

For an existing agent, edit its tool choices and save a new version. A paused run
continues with its pinned workflow. Starting a fresh run uses the updated version.

## Requested idea research example

[PR #47](https://github.com/andersj05/ResearchChain/pull/47) adds the owner-requested
[editable example](../idea-research-example.md): chart/thesis framing, human direction,
opt-in live web research with saved source references, executable OLS/correlation/
scenario calculations from supplied numbers, and a memo with final human review.
The in-app **Use idea research example** action and importable workflow now offer
optional SEC filing retrieval before the first review and again during approved
research. The calculation uses the approved research receipt for the annual
comparison, or paired data from the brief for OLS. The memo gets the recorded
sources and computed values. Load the updated example to start a new version.

Two bounded public-documentation connection checks used the existing ChatGPT plan;
the second confirmed completed streamed web activity and 13 source references after
the stream handling was corrected. No private evidence or owner judgments were used.
The focused provider/runtime/analytics suite passed; the PR records the final full
checks and browser gate. These checks establish behavior, not research quality.

## Delivered workspace

The builder baseline is [PR #38](https://github.com/andersj05/ResearchChain/pull/38).
The subsequent owner-feedback pass is tracked in [the delivery plan](../plans/0017-owner-workspace-feedback.md):

- [#39](https://github.com/andersj05/ResearchChain/pull/39): synchronized canvas dragging,
  world-aligned grid and snapped placement.
- [#40](https://github.com/andersj05/ResearchChain/pull/40): compact owner Settings.
- [#41](https://github.com/andersj05/ResearchChain/pull/41): adjustable/collapsible builder
  sidebars with keyboard controls and saved browser widths.
- [#42](https://github.com/andersj05/ResearchChain/pull/42): visible selected and actual
  models. The authorized workspace cap is 1,000 requests per rolling 24 hours.
- [#43](https://github.com/andersj05/ResearchChain/pull/43): named agents, separate version/
  run histories, recoverable drafts, conflict recovery and reliable run retries.
- [#44](https://github.com/andersj05/ResearchChain/pull/44): owner-authored bounded JavaScript
  transforms with typed inputs/outputs and inspectable durable results.
- [#45](https://github.com/andersj05/ResearchChain/pull/45): compact identity/header and
  Build, Sources, Runs, Reports, Evaluate, Versions and Status navigation.
- [#46](https://github.com/andersj05/ResearchChain/pull/46): searchable source/run/report
  collections, filters, metadata and adjustable source/run lists.

The PRs record their passing merge gates. Synthetic tests establish environment
behavior, not research quality. No real model requests or owner judgments were
submitted for this pass. Existing private research and original files were retained.

## Verified checkout and runtime

The owner's Desktop runtime tracks `dev` in **C:/Users/jense/Desktop/ResearchChain**.
Development also uses **C:/Users/jense/Documents/ChatGPT/ResearchChain**.
The owner wants each merged implementation installed and verified in the Desktop
runtime before handoff. See [Desktop delivery](../development.md#desktop-delivery).
The local app is http://127.0.0.1:3000 with its API on port 8000 and Postgres on 5433.
Use pnpm dev to restart web/API/worker and the existing owner sign-in. Owner access
is managed in Settings; the ChatGPT connection is managed in run setup.

Windows pnpm check passed formatting, lint, both type checks, 470 backend tests
and the production build. Combined CI 43972380013 passed 470 backend and 103 browser
tests. The final mobile run-list adjustment additionally passed both focused desktop/
mobile collection cases; screenshots were inspected. The PR records the final
up-to-date merge gate. Private logs: .local/workspace-final-check.log,
.local/combined-ci.log and .local/collection-layout-delivery.log.

The schema-11 backup restored into a separate database before the schema-12
migration was rehearsed and applied. All 34 previous data-table fingerprints,
30 originals (612,016 bytes), and both legacy runs were preserved. Legacy workflows
and runs remain unassigned; no arbitrary named agent was created for them.
Private receipts: .local/agents-before-upgrade/restore-receipt.json,
.local/agents-upgrade-rehearsal.json, .local/agents-upgrade-live.json and
.local/workspace-live-check.json. They are ignored and must not enter Git.

The connected ChatGPT included plan and available model list were read without
inference. The saved sign-in remains valid; do not restart sign-in without a new
owner request or a verified authentication failure. Credit permissions remain
owner-controlled in ChatGPT and are not attested by this app. The local request
allowance is policy revision 2, 1,000/rolling day, unpaused. Read Status for current
usage; historical usage counts are not live availability guarantees.

## Explicit capability boundaries

The graph header sets a workflow default and individual model steps can override it,
including in referenced subgraphs. Each attempt records the requested and returned
model. Custom model instructions retain a structured result envelope with a
6,000-character conclusion. Sources capture supplied permitted content; URL records do not fetch
web pages. Source search covers loaded records, runs the latest 20 in scope and
reports the latest 100.

[Custom code](../custom-code.md) runs synchronous JavaScript transformations with
text/number outputs in a disposable QuickJS process and bounded resources. It has
no network, filesystem, credentials, Node modules or third-party package access.
Model steps provide the web and SEC integrations described above. Browser
drafts are recoverable conveniences; saved versions and exports are durable copies.

## Optional studies and future hosting

Two earlier private pilot runs remain as optional examples. Their outstanding human
reviews are not environment blockers, and their drafts are not quality evidence.
Private pointers: .local/report-pilot.json, .local/pilot-review-owner/index.html and
.local/evaluation-inflation-20261115/comparison-delivery.json. Do not submit their
reviews on the owner's behalf or copy private content into public notes.

Keep [#6](https://github.com/andersj05/ResearchChain/issues/6) (owner pilot assessment),
[#7](https://github.com/andersj05/ResearchChain/issues/7) (independent holdouts and
human/judge calibration) and [#9](https://github.com/andersj05/ResearchChain/issues/9)
(hosting/operations) open for their remaining criteria. Local backup, encryption,
retention and monitoring exist; no off-machine destination, external alert receiver
or production hosting configuration has been selected. These are separate follow-ups.

## Runtime and maintenance invariants

Keep ExecutionControl.lock shared with PostgresSaver.lock. Physical connections own
execution/checkpoint locks; never reconnect a locked execution transparently.
Admission transactions require READ COMMITTED and commit before model work.
Failed, cancelled or uncertain requests retain their allowance slot. Recovery reuses
confirmed results; uncertain model outcomes must never be blindly retried.

Before stopping services, fence command admission and verify the queue is idle.
Verify process identity/creation time and re-enumerate descendants after shutdown;
the Windows reloader can spawn a child during termination. Confirm no old API/worker
remains before migration. Mixed versions are unsupported. Use compatible code for
pre-upgrade backups and a separate database for restore rehearsals. Do not rerun
schema-specific helpers without checking their assumptions.

Backups exclude provider credentials, owner sessions and monitor profiles. Retain
physical writer locks and cleanup reference checks; never purge private data as a
test. Browser tests use disposable e2e_ schemas and synthetic credentials. Restore
any displaced live services after testing. Verify gh authentication outside the
Windows sandbox before diagnosing token failures; use gh only for GitHub tracking.
