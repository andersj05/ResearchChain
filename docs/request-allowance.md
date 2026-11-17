# Workspace request allowance

Open **Operations > Request allowance** to inspect the rolling 24-hour count,
change the allowance, or pause new model requests. New workspaces start with
100 admissions per 24 hours. The configurable range is 1-10,000.

Save request limits applies both the number and the pause setting. Refresh
allowance reads current usage without sending a model request. Unsaved edits
remain visible during refresh. If another tab/operator changed the policy, load
the saved limits and review them before saving again. An unconfirmed save is
checked by reading current settings; the browser never replays it automatically.

## Owner workspace policy

On 2026-11-16 the owner authorized 1,000 admissions per rolling 24 hours for the
local workspace. The operator applied policy revision 2 with requests enabled;
no model requests were submitted. Read current status for usage and later policy
changes. This is the workspace's admission limit, not a guarantee of remaining
ChatGPT plan allowance. Other new workspaces retain the 100-request starting policy.

## What is counted

The allowance is shared by every research run, worker process and connected
account in the configured database/schema. The explicit provider:verify inference
also consumes a slot. Sign-in, model catalog reads, local deterministic workflows,
monitoring and status reads do not.

An admission is committed before model execution. A later connection failure,
cancellation, invalid output or worker crash keeps its slot. A completed result
reused during recovery does not need another admission. A recorded admission ID
can never be used to send another request.

Research preparation can fail before admission; that consumes no workspace slot.
The existing Model usage card counts research attempt records, including attempts
stopped before admission. The Request allowance card counts granted admissions,
including explicit connection checks. These are intentionally different counts.

The window uses the PostgreSQL clock and each admission's recorded time. Entries
older than 24 hours leave the count automatically. There is no midnight reset.
If a limit is lowered below current usage, enough entries must age out before a
slot opens; the displayed expected time accounts for this. Future timestamps
remain counted after a clock rollback. Keep the database clock accurate.

Pausing or lowering a limit affects subsequent admissions. Work already admitted
can finish; use the run's Cancel control separately when cancellation is intended.
A run stopped by this guard remains stopped. Raising the limit or resuming does
not restart it or approve a human-review checkpoint.

## Operator CLI

Run these commands from the configured checkout:

```text
pnpm usage status
pnpm usage configure --expected-revision 1 --max-requests 100 --pause
pnpm usage configure --expected-revision 2 --max-requests 100 --resume
```

Use the actual revision shown by status. A stale revision is rejected instead of
overwriting a newer choice. Status/configure make no provider call. Success exits
0; an unavailable store, invalid arguments or stale revision exits 2. An
interrupted command exits 130; read status before deciding whether to retry.

The HTTP endpoints are GET /api/usage and POST /api/usage/policy. Both require the
owner session. The mutation also requires the existing exact Origin and CSRF
checks. Public responses contain counts, times and policy settings, never ledger
IDs, account identity, credentials or research. The current snapshot is private
and not cached.

## Durability and migration

Schema 10 adds append-only policy revisions and admission receipts. A short
READ COMMITTED transaction serializes admissions and policy changes under a
workspace advisory lock. The execution connection keeps its existing run and
checkpoint ownership locks. It must commit the admission before provider work;
nested/uncommitted admission transactions are rejected. An unavailable policy
fails closed.

The migration imports all known research attempts conservatively at their
original creation times. Imported records are marked historical, without claiming
that the new policy governed them. Past standalone connection tests cannot be
reconstructed. No model request is made by migration.

Run cleanup preserves admission receipts and policy history, so removing research
cannot replenish the allowance. Receipts retain only random IDs, time, source
category and policy revision, without a foreign key back to deleted research.
The ledger and policy history are included in verified database backups.

Back up before migration and stop workers/API together while upgrading. Older
workers do not enforce this guard; do not leave mixed versions running. A
pre-upgrade backup must be restored with its matching previous checkout before
applying schema 10. Keep a verified recovery copy; do not delete migration records
or rewrite applied SQL to roll back.

Restoring an old backup restores its old ledger and settings. Admissions made
after that backup are missing, so a restored count cannot establish actual
provider usage. Review recent activity and configure the recovered workspace
before admitting new work. Another database/schema is a different workspace.

## Limits of this control

This is a hard bound on local request admissions under the configured policy.
It is not a dollar budget, a token reservation, a provider allowance meter or a
cap on requests already in flight. Each request can use a different amount.

The ChatGPT plan preview still does not accept max_output_tokens. Existing
per-run reported-token thresholds stop later calls, while time/output limits
close local streams without proving that remote processing stopped. See
[OpenAI's preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
and [research limits](hypothesis-research.md#execution-limits).

Keep provider-side credit consent and usage controls configured in ChatGPT.
ResearchChain does not attest to those settings, count other applications or
workspaces, or bypass provider limits. A local database administrator can change
code/database state; this control is not an isolation boundary against that owner.
