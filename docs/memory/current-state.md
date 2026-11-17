# Current state

Updated 2026-11-17. The owner authorized consolidating completed changes, promoting
dev to main through a merge PR, pushing the remote and cleaning up merged branches.
Public deployment remains a separate follow-up.

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

Use **C:/Users/jense/Desktop/ResearchChain**. The empty Documents/ChatGPT directory
is not the checkout; use explicit working directories. The delivery branch is main after the authorized promotion.
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
