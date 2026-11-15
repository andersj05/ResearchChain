# Durable workers

Run actions first save a command in Postgres, then return its receipt. A separate
worker executes that command. Closing the browser or restarting the API does not
cancel accepted work. The workbench follows queued and running jobs after refresh.

## Local operation

After a compatible backup and migration:

```text
pnpm db:migrate
pnpm dev
```

The development command starts the web app, API and worker. To run them separately,
use pnpm dev:web, pnpm dev:api and pnpm worker in separate terminals. All services
still use the configured local workspace and protected provider account.

```text
pnpm worker status
pnpm worker --once
pnpm worker configure --max-parallel 2 --max-pending 100
```

Status prints workspace limits and persisted job counts. Once processes at most
one available command. Configure changes durable workspace limits; first drain
pending commands and stop workers. The defaults are two simultaneous commands
and 100 pending commands, including active ones. Supported ranges are 1â€“8 parallel
and 1â€“1,000 pending commands. These limits apply across worker processes sharing
the database/schema. Workflow node concurrency is a separate, already pinned limit.

Graceful shutdown finishes active commands before exit. Hard termination is
recoverable through the saved journal. A database connection still holding its
advisory lock retains ownership: another process does not steal it merely because
time has passed. Use a direct Postgres connection, not a transaction-mode pooler.
Changes to worker code require restarting the worker process.

## Admission and recovery

POST /api/runs, /api/runs/{id}/resume and /api/runs/{id}/recover return HTTP 202
with command_id, run_id, kind and accepted_at. Read GET /api/runs/{id} for current
progress. Receipts identify accepted commands; they do not imply successful
execution. A repeated start or exact review returns the same receipt. Changed
inputs or review decisions conflict. The queue returns 429 with Retry-After
when capacity or its bounded admission lock is unavailable; reuse the request ID
when retrying.

Queued work starts when a slot becomes available. A replacement worker may resume
an abandoned claimed command from confirmed checkpoints and recorded results.
Automatic attempts stop after three losses of ownership. An ordinary execution
exception instead exposes Recover run and a redacted reason. Recovery is explicit
for old unfinished commands created before worker dispatch, and for held restores.
Workers never approve a paused human review.

A model attempt recorded as preparing, requesting or unknown fences further
inference during takeover. The run records an uncertain outcome and fails without
resending the request. Completed model results are reused if their checkpoint or
command acknowledgement was lost. Other future external tools need their own
effect journal before they can safely participate in automatic recovery.

Cancel run works while queued or executing. Cancellation signals the existing
durable execution control; it cannot undo a remote effect already sent. Signing
out revokes browser access while accepted work continues. Existing token thresholds
gate later calls and do not guarantee a strict cap on an in-flight response.

The browser saves an unconfirmed start's identity in owner-scoped session storage
so refresh can retain its retry ID. The accepted run URL and database history are
the durable source of progress. Browser storage restrictions can limit local draft
and retry recovery; in-memory requests remain available in the open page.

## Backups and upgrades

Migration 0008 adds queue settings and job metadata without enqueuing old commands
or changing research inputs. Stop web, API and worker processes during an upgrade.
Back up with compatible pre-upgrade code and rehearse migration on a separate
restored database before applying it to the owner's database.

Migration and backup lock waiters poll outside database transactions, with a
ten-second deadline. They must not retain snapshots while waiting: PostgreSQL's
[concurrent index builds](https://www.postgresql.org/docs/18/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY)
can wait for older snapshots, including a blocking advisory-lock statement.

A verified restore places unfinished queued/running jobs on hold, records the
held-command count, and leaves checkpoints, receipts and effect records intact.
Before explicit recovery, reconcile any source activity after the archive snapshot.
Starting a worker cannot automatically replay held jobs. See [backups](backups.md).

## Scope

This is a bounded local worker service for one owner workspace. It provides no
public deployment, distributed provider-secret service, arbitrary tool execution
or automatic data deletion. Retention, off-machine recovery, operational monitoring
and hosting costs remain part of issue #9. See
[ADR 0011](decisions/0011-durable-workers.md).
