# Workspace operations

Open **Operations** after signing in, or run:

```text
pnpm operations
```

The tab and CLI show the same workspace aggregates. Refresh status requests a new
snapshot; there is no automatic polling on this tab. Normal owner session expiry
still applies. Opening or refreshing status does not submit research or contact a
model provider. The CLI is a local operator command using the configured database.

## Workers and queue

Connected consumers counts the polling sessions of serving workers. One consumer
can execute one command, and pnpm worker starts as many consumers as the configured
parallel limit. Multiple processes share the same capacity. Each consumer retains
one extra database connection for presence; its execution connection and ownership
locks are unchanged. Presence disappears when that connection closes and returns
after a successful reconnect. Database outage messages are redacted and logged
once per consumer until a successful poll.

Connection presence does not establish provider responsiveness or guarantee progress.
A worker may be waiting for a model response. Reserved slots include executing work
and brief polling/configuration reservations. pnpm worker --once does not register
a persistent consumer; its reserved slot and executing command remain observable.

- **Waiting to start**: a persisted queued command.
- **Executing**: a claimed command whose run lock and workspace slot belong to the
  same database session. A run read holding only a run lock cannot count as execution.
- **Awaiting takeover**: a claimed command without that live owner. A new worker can
  inspect its saved progress under the existing recovery rules.
- **Interrupted**: work held for explicit review/recovery, including held restores.
- **Finished in 24 hours**: worker commands acknowledged in that period. A command
  may finish at a human-review checkpoint; this does not mean the whole run is done.
- **Oldest pending command**: time since the oldest queued or claimed command was
  accepted, including executing work.

Start a disconnected local worker with pnpm worker, or pnpm dev for all services.
Use **Runs** to inspect interrupted or uncertain work before recovery. Status does
not trigger recovery, cancel work or approve reviews. See [workers](workers.md).

## Storage and usage

Stored originals includes captured evidence and retained generation inputs/responses.
Original content size is their summed byte size. Workspace disk size sums this
schema's tables, indexes and TOAST storage, including reusable space. It is an
observation rather than a backup size or deletion savings estimate. Credentials,
backup files and other database schemas are excluded.

Usage covers attempts started during the displayed trailing 24-hour window. It sums
only token counts reported in the journal; missing counts remain explicit, including
in-progress attempts. It does not measure remaining ChatGPT allowance or billing.
Uncertain attempts spans all time: unknown outcomes, plus unfinished preparing or
requesting attempts without a live executing owner. Review these before new work.
Existing token thresholds still cannot cap a request already in flight.

## Access and limits

GET /api/operations requires the owner session, uses private/no-store responses,
and returns only typed counts, sizes, durations and observation timestamps. It never
returns titles, run IDs, provider names, source text, filenames, account identity,
hostnames, process IDs, credentials or exception details. These private aggregates
are not published or sent to an external monitoring service.

Record aggregates share a read-only database snapshot; advisory locks are sampled
once and can change immediately. A failed refresh is clearly labeled and leaves the
previous timestamp visible. Large workspaces can reach the existing query timeout;
the interface then reports unavailable status instead of presenting partial success.

No new database migration is required. Restart the worker with matching code to
register presence; older workers can execute but do not register as connected.
The existing backup and restore format remains compatible.

Data is retained by default. [Run cleanup](retention.md) provides explicit previews,
protected-reference rechecks, deletion receipts and retry tombstones.
[Encrypted backups](encrypted-backups.md) prepare portable recovery packages; an
actual off-machine copy and restore still require a chosen destination. External
alerting, strict spend enforcement and measured hosting remain open in issue #9.
