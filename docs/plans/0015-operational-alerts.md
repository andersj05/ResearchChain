# Operational alerts

[Issue #9](https://github.com/andersj05/ResearchChain/issues/9).
Base: dev 2ad9eea after encrypted backup PR #33.

## Outcome

Implement an explicit local operator monitor that observes the existing workbench,
database and worker aggregates without starting research or changing run state.
It can retain alert transitions and deliver content-free JSON to an owner-configured
HTTPS webhook. No real destination or background monitor is enabled during development.

## Contracts

- Conditions cover workbench/database unavailability, missing workers, overdue work,
  pending recovery and uncertain outcomes. Unknown observations preserve existing
  incident state; they must not falsely announce recovery.
- Confirm each condition over spaced observations, independently, so one flapping
  condition cannot hide another. Persist confirmed state and pending delivery
  outside the research database so a database outage can still be reported.
- Save each event and its stable ID before sending. Retry failed/ambiguous sends
  with bounded backoff and the same ID. A recipient must deduplicate event IDs;
  a successful HTTP response is transport acknowledgement, not human receipt.
- Events contain only fixed condition codes, state, an anonymous monitor UUID and
  timestamps. Do not transmit research, run IDs, account details, hostnames,
  provider information, counts, credentials or raw errors.
- Read a webhook URL and optional bearer token only through hidden local prompts.
  Protect local profiles/state with restrictive permissions and current-user
  Windows DPAPI. Do not accept secrets in command arguments or print destinations.
- Bind profiles to the configured workspace and origin. Serialize sampling/state
  changes with a process-shared lock. Refuse mismatched/corrupt state.
- Explicit check/status commands never deliver. Once/watch deliver only for an
  already configured profile. Nothing starts from the web app or pnpm dev.
- Require HTTPS and verified TLS for webhook delivery, disable redirects and
  environment proxies, bound payloads/response reads, redact transport failures.
- Keep the operator monitor separate from deployment and dead-host monitoring.
  A local process cannot report its own machine losing power or network.

## Verification

Use synthetic workspaces, private temporary profiles and local/mock HTTPS receivers.
Exercise outages, independent debounce, unknown-state handling, restart recovery,
crash/ack boundaries, deduplication, retry/backoff, concurrency, secrets/redaction,
and real worker lifecycle observations. Preserve all private research.
Run focused checks, pnpm check and exact-head CI before merging to dev.
Actual external delivery still requires an owner-selected destination and a
reviewed test alert; no private uploads, paid services or new inference are needed.
