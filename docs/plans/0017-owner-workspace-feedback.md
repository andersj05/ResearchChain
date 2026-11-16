# Owner workspace feedback

Confirmed 2026-11-16. Continue the owner-built-agent environment scope in AGENTS.md.
The owner supplies the agent design, research judgment and later usability feedback.
Complete each cohesive change on a branch, commit incrementally, open a PR to dev,
run the required checks and merge after they pass. Do not promote to main.

## Delivery sequence and acceptance

1. Canvas repair: boxes, ports and arrows move together throughout a drag; visible
   grid and snapped positions; zoom, cancellation, keyboard and undo stay reliable.
2. Agent identity: named agents with an obvious active-agent selector; separate
   revision histories; switching and reloading preserve identity and existing runs.
3. Settings: compact settings dialog for owner access and workspace controls.
4. Workspace shell: replace redundant branding/breadcrumbs with useful context;
   make navigation, selection and save/run state clear at desktop and narrow widths.
5. Panel layout: docked, adjustable sidebars with keyboard support and remembered
   widths; canvas retains useful working space and panels can be collapsed.
6. Custom code: owner-authored executable steps with explicit inputs/outputs,
   bounded execution, saved versioning, inspectable results and actionable errors.
   A model prompt is not a substitute for this capability.
7. Models and allowance: explain model/provider selection and its scope, display
   the actual model on runs, and apply the authorized 1,000/day workspace allowance.
8. Data views: improve sources/evidence, run history and report browsing; choose
   task-oriented navigation names, useful summaries, empty states and details.
9. Delivery: update guides/current state, verify retained data and the running app;
   leave the owner ready to build a simple agent and provide the next feedback.

Implementation and verification as of 2026-11-16:

| Change                                       | Delivery record                                              |
| -------------------------------------------- | ------------------------------------------------------------ |
| Canvas movement and grid                     | [PR #39](https://github.com/andersj05/ResearchChain/pull/39) |
| Compact owner Settings                       | [PR #40](https://github.com/andersj05/ResearchChain/pull/40) |
| Adjustable builder panels                    | [PR #41](https://github.com/andersj05/ResearchChain/pull/41) |
| Model visibility                             | [PR #42](https://github.com/andersj05/ResearchChain/pull/42) |
| Named agents and independent histories       | [PR #43](https://github.com/andersj05/ResearchChain/pull/43) |
| Owner-authored code                          | [PR #44](https://github.com/andersj05/ResearchChain/pull/44) |
| Compact navigation and shell                 | [PR #45](https://github.com/andersj05/ResearchChain/pull/45) |
| Source/run/report browsing and final handoff | [PR #46](https://github.com/andersj05/ResearchChain/pull/46) |

The PRs hold final merge/check status; completed work targets dev only. The live
allowance is 1,000 per rolling 24 hours, policy revision 2, as explicitly authorized.
The schema-12 upgrade preserved all 34 prior data-table fingerprints, 30 originals
(612,016 bytes), and both legacy runs after a separate backup/restore rehearsal.
Read-only runtime checks verified two workers, an idle queue, eight available models
and the existing ChatGPT connection. No inference or owner judgments were submitted.

Combined CI passed 470 backend and 103 browser tests. Windows pnpm check also passed
all 470 backend tests and the production build. Focused desktop/mobile collection
checks passed after the final mobile list adjustment; screenshots were reviewed.
See [current state](../memory/current-state.md) for the runtime receipts and handoff.
The next step is the owner's simple-agent usability review.

## Interface research and decisions

Figma's [UI3 design retrospective](https://www.figma.com/blog/our-approach-to-designing-ui3/)
explains why feedback brought docked, resizable panels back: floating panels reduced
usable canvas space and slowed frequent work. It also describes keeping important
property values visible. Its [2024 review](https://www.figma.com/blog/figma-2024-we-shipped-it-you-shaped-it/)
shows panel hiding and a compact bottom toolbar supporting focus on the canvas.
These are public first-party design accounts, not an inspection of a private Figma file.

Our application: put active agent identity above task navigation; use docked,
resizable panels around the canvas; expose selected-step properties and current
model plainly; move infrequent owner controls into Settings. Favor compact rows,
search and selection/details for collections. Keep square neutral surfaces and
restrained semantic color. A subtle world-aligned grid now supersedes the earlier
no-pattern preference because the owner specifically requested alignment help.

## Verification

Use synthetic model providers for authoring and execution tests. Do not consume
real model requests or invent owner judgments. Include mid-gesture canvas geometry,
agent isolation and switch/reload behavior, settings focus and Escape, panel keyboard
resize, custom-code errors/timeouts and durable results, model visibility, and narrow
layouts. Run pnpm check and applicable browser coverage before each code delivery.
Preserve existing private records; stop the live app only after fencing admission
and observing an idle queue, then restore it after test and upgrade work.

## Named-agent implementation

Named agents now have stable IDs and ordered version histories separate from the
shared immutable workflow documents. The selector creates blank agents or copies a
workflow, restores per-agent browser drafts and run inputs, and reloads a server
head without silently overwriting a competing save. Runs pin the exact agent and
its name at admission; identical workflow content does not mix their histories.
Legacy records remain unassigned and available in workspace-wide history.

Focused verification: five backend tests cover retry identity, conflicting/concurrent
saves, intentional reverts, exact run ownership and protected endpoints. Three new
browser cases cover desktop/mobile switching, refresh recovery, cross-agent run
iteration with Undo, and stale-tab conflict recovery; twelve existing builder and
canvas authoring checks also passed with synthetic providers. Full combined CI and
the schema-12 backup/upgrade rehearsal passed; the live upgrade preserved legacy data.

## Custom code implementation

Owner-authored synchronous JavaScript now has an editor, typed text/number wiring,
a pinned QuickJS-NG runtime in a disposable child process, bounded CPU/memory/stack
and output, and durable input/output/source-hash inspection. It makes no model
requests and exposes no host callbacks, files, credentials, modules or network.
See [the code-step guide](../custom-code.md). Existing workflow hashes and compiler
versions remain unchanged; workflows containing code pin code-0.1.0.

Seventeen backend cases passed, including errors/resource exhaustion, durable
failed runs and review resume without repeating a confirmed transform. Nine graph
contract/registry cases and two desktop/mobile authoring/inspection/error cases
passed, followed by the complete combined CI gate. This supplies custom logic
primitives; the owner still writes and judges their agent.
