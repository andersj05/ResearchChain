# ADR 0002: Postgres revisions and recoverable runs

Status: accepted for issue #2, 2026-11-13.

## Decision

Use PostgreSQL for immutable workflow revisions, immutable run manifests, a
command journal, and LangGraph's official `PostgresSaver`. A run pins a validated
revision and compiler version. Checkpoints use the run UUID as their thread ID
and `durability="sync"`. The editor never mutates a running graph.

Keep schema changes in ordered, checksummed SQL migrations. Run migrations
explicitly, including the checkpointer's own setup, under a database lock.
Application startup checks compatibility instead of silently changing schemas.

Each execution request owns a dedicated database connection and a session advisory
lock for its run. The checkpointer uses that same connection: losing the lock's
connection also prevents that worker from writing checkpoints. No process-local
lock or in-memory registry determines correctness. Short metadata transactions
commit independently of graph execution; do not hold a transaction across nodes.

Persist a command before invoking the graph and its response afterward. Resume
commands name both the checkpoint and the interrupt being approved. Identical
retries return the recorded result; a conflicting decision is rejected. Recovery
can replay a journaled decision only for its original interrupt, or continue
already accepted work with `invoke(None)`. It must stop at the next human review.
This closes the crash window between checkpoint persistence and HTTP response.

Artifact inputs are bounded content-addressed references (`sha256:<digest>`),
not embedded documents or image bytes. Retrieval, upload, and object storage
remain the evidence-ingestion milestone; references alone do not prove a source
is available or trustworthy.

## Product boundary

This remains one local workspace with a revision history. The UI can save/load
revisions, list/reopen runs after refresh, approve a specific review, and recover
interrupted execution. Use neutral Geist-inspired surfaces, compact typography,
thin borders, and a clear primary action. Keep the existing UI SDK canvas.

No model calls, public hosting, authentication, advanced graph schema, or automatic
publishing are introduced. Checkpoint recovery does not guarantee exactly-once
external side effects: future tool nodes need their own idempotency contracts.
Compiler behavior changes must retain a compatible executor or explicitly migrate
old runs; never silently run an old manifest through incompatible code.

## Validation and delivery

1. Commit local database configuration, migrations, and storage boundaries.
2. Commit durable execution and API contracts with real Postgres tests.
3. Commit revision/run UI and the restrained visual refresh.
4. Run restart, crash-window, concurrency, browser, and CI checks; update memory.

Integration tests use an isolated schema in a real Postgres instance. Include a
separate API process killed and recreated while a run is paused, an edited newer
revision, concurrent resumes, repeated conflicting decisions, and failures before
and after checkpoint writes. Test migrations and health failures as well.

## Sources consulted

- [LangGraph checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers)
- [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)
- [Postgres advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS)
- [Psycopg transactions](https://www.psycopg.org/psycopg3/docs/basic/transactions.html)
- [Geist colors](https://vercel.com/geist/colors) and
  [typography](https://vercel.com/geist/typography)

Alternatives: an in-memory registry fails across processes; a transaction around
an entire graph delays checkpoint durability and holds locks too long; SQLite
does not match the requested Postgres target; a job queue is unnecessary for the
current bounded deterministic nodes and is a separate scaling decision.
