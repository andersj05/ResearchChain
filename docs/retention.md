# Run cleanup

Open **Operations → Run cleanup**. Data is retained until the owner previews a
selection, types DELETE and confirms it. There is no scheduled cleanup.

Choose a creation cutoff and at most ten runs. The cutoff means when a run was
created, not its last activity. Review the exact run IDs, dates, states, original
counts and retained-original count. Each run link opens its saved details.
Previews expire after fifteen minutes. Each preview or confirmation transaction
is capped at thirty seconds; a timeout rolls it back.

Cleanup deletes the selected terminal runs and their commands, decisions,
execution journals, research attempts and LangGraph checkpoints. It removes only
associated originals that are no longer referenced. Evidence records, reports,
evaluations, workflow revisions and unrelated uploads are retained. References
inside retained documents, checkpoint bytes and other originals protect shared
content. Protection can be conservative when an original mentions another address.

Paused human review, unfinished commands, queued/interrupted work, active
execution and uncertain model outcomes remain protected. A report or evaluation
reference pins its run. A busy reader may temporarily exclude a run; preview again
after it finishes. If any selected record or original dependency changes,
confirmation fails atomically and requires another preview.

The browser stores only the request identity and settings under the current
owner/workspace. Refreshing checks the server for the preview and receipt; it
never repeats deletion. After a lost response use **Check cleanup result**.
Repeating the same confirmed request returns its existing receipt. A failed
preview request can be retried with the same identity. Discarding an unapplied
preview does not delete data.

Minimal run-ID tombstones permanently reject delayed starts/resumes for deleted
work, before provider selection. Use a new ID for new research. Deleted original
addresses reject stale references; uploading identical bytes through the normal
capture path can recreate an original. Immutable source updates remain forbidden.

Cleanup does not erase exports, backups, referenced data or previously transmitted
provider inputs. It does not guarantee an immediate reduction in PostgreSQL file
sizes. Keep backup and external-copy policies separate. The receipt records IDs,
counts and time, without copies of research text.

## Operator details

Migration 0009 creates retention records and installs guards on content and
checkpoint writers. It does not delete existing data. The application initializes
upstream checkpoint tables before application migrations so fresh and upgraded
workspaces get the same guards. Rehearse upgrades using a verified restored copy.

The owner-protected API provides POST /api/retention/previews,
GET /api/retention/previews/{id}, POST /api/retention/previews/{id}/apply and
GET /api/retention/receipts. Mutations use the normal exact-Origin and CSRF checks.
Confirmations require the stored digest and the exact DELETE string; clients
cannot substitute a different selection.

Writers acquire the shared workspace retention lock before row locks. Cleanup
takes admission, exclusive retention and nonblocking run locks. Reference checks
run after the writer lock. Writes require READ COMMITTED (or PostgreSQL's
equivalent READ UNCOMMITTED); snapshot-isolated reads remain supported. A stale
repeatable-read writer is rejected rather than allowed to miss a new tombstone.
Direct trusted database administrators can change guards; they are not an
authorization boundary against the database owner.

All implementation deletion tests use disposable synthetic schemas. The private
workspace is never purged as a verification step.

Workspace [request admission receipts](request-allowance.md) and policy history
are retained independently of research. Run cleanup cannot reset that allowance.
