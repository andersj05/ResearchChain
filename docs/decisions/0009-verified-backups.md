# ADR 0009: verified logical backups into new databases

Status: accepted for the local workbench; operational issue #9 remains open.

## Decision

Use matching PostgreSQL custom archive tools and an application-owned manifest.
Acquire the shared migration lock before opening a repeatable-read snapshot,
fingerprint data/schema and export that snapshot to pg_dump. Sequences are not
MVCC data; compare restored values against pre-dump floors.

Use matching native clients or verified local Docker clients. Pass connection
credentials in child environments, stream binary files directly, suppress raw
diagnostics and terminate only the failed operation's named database sessions.

Write into fresh private directories and publish the manifest last. Require an
ignored destination inside the checkout. Include all application/checkpoint tables
and verify actual original-file hashes. Exclude provider credentials, other
schemas, cluster roles and grants.

Restore explicitly trusted archives into a named, nonexistent database using a
temporary restricted login/owner. Do not execute the archive as the administrator
or allow archive-controlled database creation. Restore atomically, verify data,
schema and originals, then transfer ownership and remove the temporary role.
Quarantine failed targets instead of deleting or reusing them.

## Consequences

The owner can rehearse local recovery without inference or silently switching the
live database. Paused workflows can resume; uncertain provider outcomes cannot
be resent. Checksums establish integrity, not trust. Restricted ownership is not
a hostile-SQL sandbox. A killed process can leave a target needing inspection.

A pre-upgrade backup plus compatible code is the rollback boundary. Earlier
migrations can commit before a later one fails; switching code does not undo
that state. Recovery uses a fresh database and an explicit configuration switch.

Retention, off-machine replication, PITR and automatic failover remain hosting
decisions. See [the operator procedure](../backups.md).
