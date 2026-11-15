# Durable research workers

Follow-on to owner access [PR #28](https://github.com/andersj05/ResearchChain/pull/28),
merged as e7ee33e, and tracked by
[issue #9](https://github.com/andersj05/ResearchChain/issues/9).
Implement on feat/durable-workers.

## Current behavior

Run commands, immutable inputs, checkpoints and model-attempt journals are already
durable. The API's start, resume and recover handlers nevertheless call the runtime
driver synchronously. A dedicated Postgres advisory-lock connection serializes
each run; losing it abandons that execution. Reads distinguish active and interrupted
commands without waiting for model calls. Cancellation uses a separate connection.

## Intended change

Persist an accepted command and return promptly, then execute it in an explicit
local worker with bounded concurrency. Define queued, owned, finished and interrupted
states and their recovery behavior before choosing a claim/lease mechanism.
Admission must validate the pinned workflow, evidence, provider account and exact
review checkpoint before a worker can execute. Preserve stable command receipts
so retries after a lost HTTP response cannot duplicate an accepted action.

Use the database to arbitrate multiple worker processes and recover abandoned
ownership. Retain the dedicated run connection and shared ExecutionControl /
PostgresSaver lock, or prove an equivalent fencing guarantee before changing them.
A stale process must not keep writing after another worker takes ownership.
Document graceful shutdown, hard failure and database disconnect behavior.

Keep the existing rule for uncertain provider outcomes: a request that may have
reached the provider is never silently resent. Recovery may continue confirmed
checkpointed work; unresolved external effects require an explicit visible decision.
A worker startup must not resume the owner's previously paused or uncertain runs.
Cancellation must work while queued and running, and resource limits must bound
admission, polling and execution without claiming a strict in-flight spend cap.

Expose enough status for the workbench to follow accepted work and recover after
refresh. Preserve current draft and review protections through sign-out or session
expiry. Authorize admission and status through the existing owner boundary.
The initial worker remains local and shares the configured workspace and protected
provider account; public deployment and multi-host credential distribution remain
separate operational work.

## Verification and delivery

Use synthetic providers and isolated databases. Cover concurrent duplicate
admission, distinct-input conflicts, two workers contending for one command,
loss of the HTTP response, process death before and after claiming, stale ownership,
database disconnects, queued/running cancellation, worker restarts, exact review
conflicts and uncertain inference without resend. Keep backup/restore compatible
with command ownership and migration recovery.

Run focused checks as implementation proceeds, then pnpm check and production
browser tests for changed run interactions. Commit coherent steps frequently,
open the feature PR into dev and merge after CI. Leave issue #9 open for retention,
redacted observability, off-machine recovery and measured hosting configuration.
Do not fabricate review decisions or labels for issues #6/#7.
