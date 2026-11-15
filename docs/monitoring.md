# Operational checks and alerts

The monitor is an explicit local operator command. It reads the existing database
aggregates and workbench health endpoint, confirms persistent problems, and records
alert transitions in a private profile. An owner-configured HTTPS receiver can
receive those events. Neither opening Operations nor starting pnpm dev starts a
monitor or sends a notification.

## Check current conditions

From the repository root, with the normal database/origin configuration:

```text
pnpm monitor check
```

This performs one immediate observation. It creates no profile, changes no research,
reads no ChatGPT credentials and delivers no notification. The output contains only
fixed condition codes, true/false/unknown observations and a timestamp.

| Condition               | Meaning                                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| database_unavailable    | Database status could not be read, including connection, migration or query failures. Other database-backed conditions remain unknown. |
| workbench_unavailable   | The configured workbench health endpoint did not return its expected successful response.                                              |
| workers_missing         | Fewer serving worker consumers are connected than the configured minimum.                                                              |
| work_overdue            | A queued or executing command exceeds the configured age threshold. This does not prove it is stalled.                                 |
| recovery_required       | Commands await takeover or are held as interrupted.                                                                                    |
| uncertain_outcomes      | The attempt journal contains outcomes requiring review.                                                                                |
| observation_unavailable | An unexpected probe failure prevented a reliable observation. Existing incidents remain active until observed recovery.                |

These are availability and operational signals. They do not establish research
quality, provider responsiveness, remaining plan allowance, billing or spend caps.
No alert recovers a run, approves a checkpoint, purges data or resends a model call.

## Create a private profile

The parent directory must exist. Choose a new private directory, such as an ignored
.local location or a location outside the checkout. For local records only:

```text
pnpm monitor setup --profile .local/monitor-local --local-only
```

For an external receiver:

```text
pnpm monitor setup --profile .local/monitor-alerts
```

Enter the HTTPS webhook URL and optional bearer token at the hidden terminal prompts.
An empty URL creates a local-only profile. Secrets are not accepted as command
options, environment settings or visible prompt fallback. Do not paste them into chat.
Setup stores configuration but starts no process and sends nothing.

Profiles bind to the configured database workspace and canonical workbench origin.
Changing a database password does not change that binding. A different database,
schema or origin requires its own profile. Profiles are immutable: setup refuses to
overwrite an existing directory.

The defaults require at least one connected worker, consider work older than
900 seconds overdue, and confirm each condition with two observations spaced at
least 60 seconds apart. Recovery requires the same confirmation. Override these
during setup with --minimum-workers, --pending-seconds, --confirmations and
--interval-seconds. Use zero minimum workers only when intentionally monitoring a
workspace without a serving worker. Fast repeated commands do not inflate counts.

Confirmation is independent for each condition. A flapping condition cannot hide a
different persistent problem. Unknown observations reset the confirmation streak
but retain any previously confirmed incident. Keep the machine clock correct; a
backward clock change stops sampling rather than silently changing event order.

## Review the receiver contract and test delivery

The receiver must accept HTTPS POST with application/json and return a 2xx response
when it has accepted an event. A fixed test event can verify a chosen receiver:

```text
pnpm monitor test --profile .local/monitor-alerts
```

This command explicitly sends one event with kind test and an empty active list.
It does not probe research, acknowledge a pending incident, or change monitor state.
Only run it after choosing and reviewing the destination. No real receiver or
external test notification is configured as part of implementing this feature.

Operational events use this shape; these identifiers and timestamps are examples:

```json
{
  "version": "researchchain.operational-alert.v1",
  "id": "00000000-0000-4000-8000-000000000001",
  "monitor_id": "00000000-0000-4000-8000-000000000002",
  "sequence": 1,
  "created_at": "2026-01-01T00:01:00Z",
  "observed_at": "2026-01-01T00:01:00Z",
  "kind": "problem",
  "active": ["workers_missing"]
}
```

Each operational event has an increasing, persisted sequence number. Receivers
should acknowledge but not apply events older than the highest applied sequence
for that monitor, so asynchronous processing cannot reactivate a stale incident.
Test events use sequence zero and never advance the incident sequence.

The monitor ID is random. Payloads contain no run IDs, research, source filenames,
counts, account identity, hostnames, provider information, credentials or raw errors.
An optional webhook bearer token goes only in the Authorization header to the
configured receiver. The webhook URL itself may also be a secret.

The active list is the **complete confirmed condition set**, not a patch. A
recovered event has an empty list. A consumer should replace that monitor's active
set when it accepts a new event, and keep test events separate from real incidents.

The Idempotency-Key header equals the event ID. Receivers must deduplicate by that
ID and acknowledge duplicates with 2xx. Events are saved before sending, so a crash
after remote acceptance but before the local acknowledgement can cause a repeat.
HTTP acceptance does not prove that a person received or read a notification.

Pending events retain their original ID, payload and observation timestamp across
restarts. A confirmed recovery that occurs while a problem event is pending follows
that event after it is acknowledged. Consumers should show timestamps because
queued notifications can arrive after the underlying condition changed.

This is a generic JSON webhook contract, not a built-in Slack, email or Teams
integration. Use a receiver that implements it. TLS verification remains enabled;
redirects and environment proxies/CA overrides are disabled. Response bodies are
not downloaded, outgoing events are bounded, and HTTP exchanges have a ten-second
overall deadline. Transport logs and raw failures are suppressed.

## Run or inspect a monitor

```text
pnpm monitor once --profile .local/monitor-alerts
pnpm monitor status --profile .local/monitor-alerts
pnpm monitor watch --profile .local/monitor-alerts
```

Once samples if due and attempts pending delivery if due. Status only reads saved
state: it never probes or delivers. Watch runs in the current terminal until Ctrl+C.
It installs no service or schedule. Its interval starts after each cycle completes,
so slow checks do not cause a catch-up burst. Database checks retain the existing
connection and per-statement timeouts; the HTTP deadline is not a whole-cycle bound.

A process-shared lock serializes each profile's sampling, outbox and acknowledgement.
A competing operator may receive a busy error. Run one profile per intended monitor;
separate profiles intentionally have separate IDs and can emit duplicate incidents.

Failed delivery keeps the event and retries with exponential backoff, bounded at
one hour. Retry-After seconds or HTTP dates are respected within that limit. One
cycle attempts at most one event. Status reports pending delivery and its next
attempt time; it never hides a failed delivery behind an otherwise healthy probe.

Local-only profiles publish the latest event durably in their protected state
instead of sending it. Status can retrieve that event even if terminal output was
lost. This is a bounded latest-state record, not a permanent event-history archive.

Exit codes: check returns 0 for no observed problem and 1 for a current problem.
Once/status return 0 for no confirmed incident, 1 for a confirmed incident, and 2
for failed delivery or an operator/configuration error. Pending confirmation remains
visible in the output. Watch continues through delivery failures and exits with 130
on Ctrl+C; unrecoverable profile/configuration errors stop it with code 2.

## Storage, rotation and operating limits

Profiles and state use private directories and atomic state replacement. Windows
uses current-user DPAPI and an owner-only directory ACL. Unix uses owner-only
directory/file permissions. Symbolic links, junctions, wrong bindings, oversized
files and corrupt state are refused. Files are preserved when a read fails.

Monitor configuration/state is outside the research database and its backups.
A lost or different machine needs a new profile and reviewed destination setup.
Retain any pending state needed for diagnosis. Rotating credentials or a destination
means stopping the old monitor, inspecting its saved state, creating/testing a new
profile, and retiring the old monitor ID at the receiver. Do not silently redirect
an old outbox or assume that retiring a profile sends a recovery event.

A local monitor cannot report its own host losing power, its own process stopping,
or total network loss through the same network. Hosted operation still needs an
external watchdog and a reviewed service/scheduling arrangement. No public
deployment, paid monitoring service or automatic notification has been enabled.

Tests use synthetic research, temporary profiles and local/mock HTTPS receivers.
They cover real worker presence, unchanged research fingerprints, independent
confirmation, unknown observations, restart/acknowledgement failures, process
locking, hidden prompts, redaction, TLS verification and bounded network behavior.

See [operations](operations.md), [ADR 0015](decisions/0015-operational-alerts.md) and
[issue #9](https://github.com/andersj05/ResearchChain/issues/9).
