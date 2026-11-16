# ADR 0018: Bounded JavaScript transformation steps

Date: 2026-11-16. Status: accepted.

## Context

The owner needs to supply logic that is not represented by the built-in steps.
Model instructions do not provide deterministic execution of that logic. Code must
retain the workflow's immutable versioning, typed connections and inspectable runs.

## Decision

Add synchronous JavaScript function bodies with text/number inputs and outputs.
Execute each step in a disposable Python child using pinned QuickJS-NG 0.18.0.1.
Pass JSON only, without Python callbacks, environment data, filesystem/network,
Node modules or package loading. Enforce CPU, wall-clock, heap, stack and output
limits and stop a failed run with an actionable reason.

Record actual inputs, outputs, duration, engine version and code hash in durable run
events. Existing workflows keep their original canonical hashes and compiler versions;
workflows containing code pin code-0.1.0. Confirmed results survive human checkpoints.
An interrupted pure transformation can replay during explicit recovery before its
checkpoint was confirmed; there are no supported external side effects to repeat.

## Alternatives and consequences

Executing Python in the API process would expose the host and make resource control
harder. A model-based approximation would not execute the owner's code. General
containerized tool execution would add installation and orchestration work beyond
this local transform capability.

The chosen runtime supports owner-written pure transformations, not arbitrary tool
integrations or hosted untrusted-code execution. Python, packages, external services,
async work and persistent process state need separate designs. JavaScript numbers
use floating-point arithmetic. See [the code guide](../custom-code.md) for the exact
limits, authoring instructions and validation evidence.
