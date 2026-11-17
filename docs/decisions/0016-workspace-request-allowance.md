# 0016: Durable workspace request admissions

Status: accepted for implementation, 2026-11-15.

## Context

Per-run call limits do not bound the sum of separate runs or processes. A
workspace pause must also order consistently with concurrent admission.
Research deletion must not replenish a recent allowance. Provider-side token
and billing limits remain separate from a local request counter.

## Decision

Use PostgreSQL for append-only policy history and a separate admission ledger.
The initial policy permits 100 admissions per rolling 24 hours, adjustable from
1 to 10,000 with an independent pause flag. Import known historical research
attempts conservatively during schema 10.

Admission and policy edits take the same transaction advisory lock. READ
COMMITTED obtains current committed state after waiting for that lock; repeatable
read and outer transactions are rejected on admission. Commit before model work,
retain physical run/checkpoint ownership, and release the policy lock before
network I/O. Failed or uncertain downstream work never refunds an admission.

Use attempt IDs for research and new IDs for explicit connection tests. Reject
reused IDs. Keep the ledger independent of research foreign keys and retain it
during cleanup. Per-attempt admission metadata identifies the applicable policy.
The operator is a trusted local actor; the web mutation requires owner/Origin/CSRF.

Policy writes compare the revision the user reviewed. The browser retains dirty
edits, requires loading changed settings, and blocks another write after an
ambiguous outcome until it has read current state. Reads never submit research.

## Consequences

Concurrent workers cannot spend the same final slot. New runs, account changes,
process restarts and research cleanup do not reset the count. Immutable receipts
and policies survive verified backup/restore, subject to the backup's age.

The limit governs admissions, not completed or billable requests. An admitted
call can still execute after a later pause. Conservative failed admissions can
use capacity without provider work. Database time defines the rolling window.
Old backups and distinct workspaces do not prove account-wide usage.

OpenAI's [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
still exclude max_output_tokens. This implementation does not claim a hard
in-flight token/dollar cap or silently change the owner's provider/billing route.
