# 0013: Confirmed run retention

Status: proposed, 2026-11-15.

ResearchChain keeps research by default. Owner cleanup targets a reviewed, bounded
set of terminal runs by creation time. Reports, evaluation data and evidence remain
durable references; a run they reference cannot be deleted. Pending or uncertain
execution and human review also remain protected.

A persisted preview expires after fifteen minutes. It contains selection IDs,
content fingerprints and counts, not copies of briefs or source contents.
Confirmation revalidates the exact selection and original-reference closure in
one transaction. Any change rejects the entire operation. An immutable receipt
makes repeating a confirmed request safe after a lost HTTP reply.

Statement-level writer locks serialize reference creation with cleanup before row
locks are taken. Cleanup takes the admission lock, exclusive workspace retention
lock and nonblocking run locks in that order. Run and original tombstones prevent
a creator that read stale data before cleanup from committing dangling JSON
references. Run IDs never become reusable. Identical original bytes may be
uploaded again through the normal validation and storage path.

Immutable updates stay prohibited. A transaction-local, schema-bound allowlist
permits deletion only of the selected immutable run records and originals.
Evidence, report and evaluation tables cannot use this exception. Retained
originals are found through remaining records, checkpoints and transitive original
references; uncertainty retains bytes or rejects cleanup.

Cleanup is not full erasure: referenced originals, unrelated orphan uploads,
workflow revisions, exported files and backups remain. PostgreSQL can reuse freed
space without immediately reducing files on disk. There is no automatic expiry
job. All destructive implementation tests use isolated synthetic workspaces.
