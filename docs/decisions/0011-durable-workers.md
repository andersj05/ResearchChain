# 0011: Durable admission and workers fenced by Postgres sessions

Date: 2026-11-15

## Context

The run journal already pinned inputs and exact review decisions, but HTTP requests
drove LangGraph synchronously. API lifetimes and long proxy timeouts therefore
owned execution. Accepted work must survive API restart without duplicating model
requests, bypassing human review, or replaying an old backup automatically.

## Decision

Persist each new command and its dispatch job atomically. The public run actions
return a stable HTTP 202 receipt; current state remains a separate read. A bounded
workspace admission lock serializes capacity checks and mutations. Start IDs and
exact checkpoint/interrupt decisions retain their existing conflict rules.
HTTP retries never requeue an interrupted old command implicitly.

Use explicit worker processes and database-wide slot locks for concurrency.
Workspace limits live in Postgres, shared by all processes. A worker owns a slot,
the run advisory lock, checkpoint writes, execution controls and effect journal
on one physical connection. It does not reconnect a running command after losing
that connection. ExecutionControl and PostgresSaver continue sharing their mutex.
A time-based lease alone could allow an old writer to overlap a replacement;
ownership instead ends when Postgres releases the session lock.

A replacement may reclaim an abandoned running job, up to three automatic attempts.
Confirmed model output is reused. Any preparing/requesting/unknown attempt fences
further inference and records failure with an uncertain outcome. Unexpected handled
exceptions require explicit recovery, with authored messages instead of raw
exception contents. Paused reviews and pre-migration commands are never enqueued
just by worker startup.

After verifying an archive's exact snapshot fingerprints, restore places unfinished
queued/running jobs on hold and reports their count. This intentional change is
limited to mutable job ownership/status. The snapshot cannot establish whether the
source performed those commands after the backup; recovery requires reconciliation.

## Consequences

The web app can release its action controls promptly and follow queued progress.
Queued cancellation and owner-session expiry preserve the existing execution and
authorization boundaries. The browser retains unconfirmed start IDs across refresh
using owner-scoped per-tab storage. API restart leaves independent workers intact.

This changes run-action responses from snapshots to receipts, so API, browser and
worker code must be upgraded together. Old synchronous driver methods remain local
runtime/test operations; HTTP uses only durable admission. Direct Postgres sessions
are required, and failure detection depends on Postgres releasing a dead connection.
This is not an exactly-once guarantee for arbitrary external effects or a public,
multi-host deployment.

Tests cover atomic admission rollback, repeated/lost acknowledgements, exact review
conflicts, shared capacity, independent processes, hard death at claim/receipt
boundaries, database disconnection, uncertain inference, cancellation and held
restores. Browser tests exercise queued refresh, cancellation and retry identity.
This supersedes ADR 0002's explicit-recovery-only behavior for newly dispatched
commands, while preserving its journal, pinning and connection-fencing invariants.
