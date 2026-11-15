# 0006 — Journal research attempts independently of checkpoints

Accepted 2026-11-14 for the first bounded live research workflow.

## Decision

Workflow schema 0.3 adds research settings, typed hypothesis stages and reviewer
feedback while preserving 0.1/0.2 canonical documents and compiler selection.
Python contracts remain authoritative. Runs pin their provider/account, model,
prompt hashes, evidence snapshots and execution settings separately from credentials.

A durable attempt journal precedes every provider call. Store the exact request
artifact, validated result, raw response text, response/model identifiers and reported
usage. Recovery reuses completed attempts. A preparing/requesting attempt after
interruption becomes unknown and is not resent. Checkpoint replay cannot promise
exactly-once remote inference; explicit unknown outcomes are preferable to invisible
repeated usage.

Serialize model attempts within a run, including graph forks. Enforce local budgets
at admission and while streaming; record partial or unavailable usage accurately.
The ChatGPT-plan route cannot hard-cap output tokens, so its token threshold gates
subsequent calls. Credit settings are controlled by the provider, not inferred from
a local billing label. No API-billing fallback is implemented.

Progress reads use MVCC and a nonblocking advisory-lock probe. A held lock only
means running when an unfinished command also exists; concurrent readers must not
hide a paused review. Execution, guards, journal writes and PostgresSaver retain the
same connection lock. Cancellation uses a separate connection and stops the live
provider task cooperatively.

## Consequences

Human review and citations remain inspectable and reproducible. The journal can
preserve a result even if its graph checkpoint is interrupted. Unknown requests
require an intentional new run. Payloads and results may contain private research
and must remain out of Git. Images/PDFs and unavailable references retain their
source representations; validation does not establish semantic truth.

See [the workflow guide](../hypothesis-research.md) for controls and limitations.
