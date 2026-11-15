# ADR 0012: Observe workspace operations without private content

Status: accepted for the local owner workspace, 2026-11-15.

## Context

Durable command dispatch separates API availability from worker availability. Persisted
job state alone cannot distinguish an idle worker from a dead process, and an active
run lock can belong to a reader. Owners need a useful diagnosis without copying
research content, provider errors or credentials into telemetry.

## Decision

Add an authenticated aggregate endpoint, an Operations tab with explicit refresh, and
a local CLI. Query counts, reported token usage and schema-local storage under one
read-only repeatable-read transaction. Sample advisory locks once; executing ownership
requires a run lock and workspace slot held by the same session.

A serving worker consumer holds a shared session advisory presence lock on a separate
connection. Closing or losing that session removes presence automatically. Execution,
checkpointing and effect journaling retain their existing physical connection fence.
Reconnect presence only between commands; never reconnect an executing command.

Return only typed aggregates. Keep errors redacted, log database outages once per
consumer until recovery, and use the existing owner boundary and private cache headers.
Manual refresh avoids a new background poll keeping owner sessions alive.

## Consequences

The view distinguishes queue abandonment, interruptions and uncertain model effects,
but connected sessions are not a liveness deadline or a provider-health guarantee.
A hung connection remains present until PostgreSQL closes it. Each consumer uses an
additional database connection. Short one-off workers remain observable as execution
without registering persistent presence.

This avoids heartbeat tables, migrations, stale lease cleanup and a separate telemetry
service. It provides workspace diagnosis rather than distributed alerting. Storage
includes index/reusable space; usage reports missing token counts and is not billing.
Status never changes queue state or invokes providers.

Retention needs a separate mutation design: dependency protection, safe lock ordering,
minimal tombstones and idempotent confirmation. Operational inventory does not satisfy
that requirement. No private deletion or hosted deployment is introduced here.
