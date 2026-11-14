# ADR 0003: Bounded structured workflows

Status: accepted for issue #3, 2026-11-14.

## Contract

Keep the chain-0.1.0 compiler available for existing manifests. Workflow schema
0.2 adds registered typed ports and configuration, paired conditional/fan-out
splits and joins, and subgraph references pinned to definitions in the immutable
revision. Each definition has an explicit version. Recursive references and
unstructured cycles are rejected before saving or executing.

A loop invokes a versioned body with a finite iteration limit. Conditional loops
stop when their predicate succeeds; reaching the limit without success is a
visible limit outcome. Fixed-count loops complete normally. Expansion limits
bound nested loops and subgraphs. Qualified execution paths identify each node
invocation and preserve review identity through restart and parallel execution.

Fork branches are disjoint until their explicit join. A conditional join accepts
its selected branch; a parallel join waits for every branch. Nested splits are
allowed. No executable expression or Python arrives from the browser.

## Execution

Compile validated definitions to LangGraph nodes with checkpointed, merge-safe
outputs and events. Preserve the original compiler/state layout for v0.1 runs.
New runs pin the new compiler and complete definition bundle. Enforce node,
active-execution-time, and concurrency limits. Cancellation is persisted outside
the execution lock so another request can stop an executing run cooperatively.
No model or external tool calls are introduced in this milestone.

Subgraphs and loop invocations are lowered into qualified nodes in the parent
LangGraph. This preserves explicit checkpoint identities across the bounded
expansion. The execution-time budget excludes completed review pauses; abandoned
command intervals are conservatively charged through recovery, including downtime.

## Delivery and validation

Commit the contract/validator, compiler, durable execution controls, API/types,
and integration tests separately as they become coherent. Validate split/join
reconvergence, nested references, loop termination/exhaustion, typed wiring,
multiple reviews, cancellation, budgets, and restart with the original revision.
Run all repository checks and browser regressions before merging into dev.
The next feature adds full visual authoring for this contract (issue #4).

References: https://docs.langchain.com/oss/python/langgraph/graph-api and
https://docs.langchain.com/oss/python/langgraph/use-subgraphs.
