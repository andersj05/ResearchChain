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

All items remain pending until linked to a merged PR and verified outcome. Existing
PR #38 delivered the first builder baseline; it does not complete this feedback.

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
