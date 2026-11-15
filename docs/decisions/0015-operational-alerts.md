# ADR 0015: Explicit operational alerts

Status: accepted for the local operator workflow, 2026-11-15.

## Context

Operations already provides content-free status but needs an operator to refresh
it. A database outage must not prevent the monitor from retaining an alert, and
unknown observations must not incorrectly clear earlier incidents. External
delivery also needs safe replay after an ambiguous HTTP acknowledgement.

## Decision

Keep monitoring in an explicit local CLI, separate from the API and workers.
Read the existing workbench health endpoint and database aggregates. Do not load
provider credentials, invoke a model, change research or install a background job.

Use a private, workspace/origin-bound immutable profile and an independently stored
state file. Protect Windows files with current-user DPAPI and private ACLs; use
owner-only Unix modes. Read destinations and optional bearer tokens only through
hidden interactive prompts. Keep profiles out of research backups.

Confirm each condition independently over spaced samples. Unknown inputs reset
its streak but preserve confirmed incidents. Persist a pending event and retry
deadline before network delivery, then save acknowledgement only after HTTP 2xx.
A process-shared lock serializes the complete cycle across operators.

Send only fixed condition codes, a random monitor ID, event ID and timestamps.
A persisted sequence orders each monitor's operational events; the receiver
ignores older sequences and keeps test events separate at sequence zero.
A full condition set replaces the prior set at the receiver. Preserve event IDs
and payloads across retries; require receiver deduplication and duplicate 2xx
acknowledgement. A recovery observed during failed delivery follows the pending
event after its acknowledgement. This is at-least-once transport, not exactly-once
notification or proof of human receipt.

Use verified HTTPS with redirects and environment proxies disabled. Bound payloads,
skip response bodies and enforce an overall HTTP deadline. Emit only authored
diagnostics; webhook URLs and raw HTTP errors must not enter transport logs.
An explicit test command sends a test event without altering real incident state.

## Consequences

No database migration, public API change, new dependency or provider inference is
introduced. Local-only mode stores its latest event without external transmission.
Profiles are immutable; destination/credential rotation uses a new profile and
explicit retirement of the previous receiver identity.

Actual alert delivery still needs an owner-selected receiver implementing the
documented JSON contract and a reviewed test notification. No receiver is enabled
during implementation. A local process cannot detect its own host loss; hosted
operation needs an external watchdog and a separate service/deployment decision.

HTTPX documents [network timeouts](https://www.python-httpx.org/advanced/timeouts/),
[environment configuration](https://www.python-httpx.org/environment_variables/) and
[streamed responses](https://www.python-httpx.org/quickstart/#streaming-responses).
The additional asyncio deadline bounds the whole HTTP exchange rather than only
individual periods of network inactivity.
