# Structured workflows

Schema `0.2` extends the local deterministic runtime with conditions, parallel
branches, explicit joins, bounded loops, and reusable subgraphs. The existing
`chain-0.1.0` executor remains available for immutable v0.1 run manifests. New
structured runs use `structured-0.2.0`. These nodes do not call models or research
providers and do not generate reports.

## Nodes, ports, and configuration

`GET /api/node-types` returns registered node types, their typed ports, and JSON
configuration schemas. Control edges name `source_port` and target `in`. Each
control output must connect exactly once, except Finish, which has no output.

| Node                | Configuration and behavior                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| Note                | Records instructions, or text bound through `inputs.text`; outputs `text`.                        |
| Review              | Pauses for a checkpoint-specific decision; outputs `decision`. Rejection stops the run.           |
| Condition (`route`) | A typed predicate selects `true` or `false`; `config.join` names the corresponding join.          |
| Parallel (`fork`)   | `config.branches` names 2–8 output ports; all branches must reach `config.join`.                  |
| Join                | Belongs to exactly one split; waits for all parallel branches or the selected conditional branch. |
| Subgraph            | `config.ref` contains a definition `id` and integer `version`.                                    |
| Loop                | Invokes a pinned body at most `max_iterations` times (1–20); outputs `iterations`.                |
| Finish              | Returns from a body or completes the root workflow.                                               |

Every graph has one start and one Finish. Branches are disjoint until their
paired join; splits can nest. Unstructured cycles, crossed joins, disconnected
nodes, unknown ports, and recursive subgraph references fail server validation.

Text inputs can read `brief` or an earlier Note's `text`. Predicates read `brief`,
`artifact_count`, `iteration`, or a typed output using `node_id` and `port`.
Comparisons support equals/not-equals, text contains, and numeric gt/gte/lt/lte.
Output references must be guaranteed available on every applicable path. A
conditional merge cannot consume an output that exists only on its unselected
branch. A parallel join can consume outputs from all its branches.

Subgraph definitions live in the workflow revision's `subgraphs` bundle. An
`id`/`version` pair is unique within that immutable bundle; revisions freeze the
entire bundle, so later edits cannot change a paused run. Definitions cannot
reference themselves, directly or indirectly. Nesting is limited to eight levels
and compilation to 2,048 expanded nodes.

## Loops and checkpoints

Without `until`, a loop executes the body exactly its bounded count. With `until`,
it evaluates the predicate after each successful body invocation and exits as
soon as it succeeds. Reaching the count without satisfying the predicate produces
a durable `limited` result, not a successful report. The predicate can inspect
guaranteed body outputs or the one-based iteration number. Outside a loop,
`iteration` is zero.

The compiler lowers each subgraph invocation and bounded iteration into qualified
LangGraph node paths. This keeps checkpoint/review identity explicit, e.g.
`root/review_loop/iteration-2/review`, without invoking untrusted code or relying
on private LangGraph checkpoint namespaces. Branch outputs and events use
merge-safe keyed state. Parallel joins wait even when branches have unequal
lengths. Each pending review has its own interrupt ID; approving one cannot
approve a sibling or a later iteration.

## Budgets and cancellation

`budgets` sets `max_node_executions` (default 256), `max_active_seconds` (120), and
`max_concurrency` (4). Node counts identify logical invocation paths, including
control checks; re-entering the same interrupted review does not spend another
node. Reservations are persisted and shared by parallel branches. Concurrency
bounds the LangGraph worker pool.

Time covers accepted execution-command intervals, excluding completed human
review pauses. An interval abandoned by a killed process is charged through
recovery, including downtime. This conservative policy prevents restart from
resetting the budget. Registered nodes check cancellation and time at boundaries;
future network tools must also set per-call timeouts and idempotency keys.

`POST /api/runs/{id}/cancel` records cancellation without acquiring the execution
lock, so a separate request can signal a running worker. Cancellation is
cooperative, idempotent, and terminal. Completed/rejected results cannot be
rewritten by cancellation. Limits and cancellation persist across refresh and
recovery and include a visible reason. No background worker or hosted service is
introduced.

## Example and editor boundary

`examples/advanced-workflow.json` joins two notes, then pauses inside two passes
of a review loop. Save it through `POST /api/revisions` in the local API reference,
then open `/?revision=<returned id>` in the workbench and run it. Apply migrations
first with `pnpm db:migrate`.

The workbench renders structured revisions, allows instruction/name/layout
edits, and supports their run history, individual reviews, cancellation, and limit
results. Chain-only structural controls are disabled for these documents.
Full port wiring, nested editing, configuration forms, grouped history, and JSON
import are the next stage in issue #4; API authoring is available now.
