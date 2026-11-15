# Backup, restore and migration recovery

ResearchChain keeps original files, evidence, immutable revisions, reports, style
guides, evaluations, run journals and LangGraph checkpoints in PostgreSQL.
These commands back up the selected application schema and verify restoration
into a **new database**. They do not start workers or call a model.

## Create a backup

Start the local database, then run from the repository root:

```text
pnpm db:up
pnpm db:backup --output .local/backup-before-upgrade
```

The parent directory must exist and the destination must be new. Inside the
checkout, use an ignored .local/, data/ or artifacts/ destination. An explicit
path outside the checkout also works. Windows directories receive an owner-only,
inheritable ACL; Unix directories use mode 700 and files use 600. Archives contain
private research in plaintext; use appropriate encrypted storage when copying
them elsewhere. No upload, schedule or automatic deletion is configured.

DATABASE_URL and DATABASE_SCHEMA select the source; credentials belong in the
environment or ignored .env, never command arguments. The URL must explicitly
identify the host, database and user. Service files and custom libpq options are
unsupported. Native pg_dump and pg_restore must match the server major version.
Otherwise the command uses the local Compose container after verifying it is the
same server. RESEARCHCHAIN_PG_CONTAINER can select that container by its full ID,
as CI does. Custom TLS connections require native tools.

The source must have current application and checkpoint migrations. A shared
migration lock is acquired before taking a repeatable-read snapshot; pg_dump uses
that same exported snapshot. Ordinary writes can continue, so a backup can include
unfinished runs. Sequences advance outside MVCC and are checked against their
pre-dump floors.

A complete directory contains:

- database.dump: a binary PostgreSQL custom archive, streamed without a shell.
- manifest.json: format/version, timestamp, code commit and dirty flag, migration
  checksums, archive size/hash, table and schema fingerprints, original-file
  totals and sequence floors.

The manifest is published after the archive is complete and synced. A partial
directory without a valid manifest is unusable; choose a new destination after a
failed attempt. Backup creation alone is **not a tested restore**. Rehearse the
next procedure and retain its success receipt.

## Restore and verify

Use compatible code and the same PostgreSQL major version. After an upgrade, use
a clean checkout of the manifest's code commit and its locked dependencies.
A dirty-code flag means that commit alone cannot reconstruct uncommitted changes.
Restore checks exact application and checkpoint migration compatibility first.

```text
pnpm db:restore --input .local/backup-before-upgrade --database researchchain_rehearsal --trust-source
```

DATABASE_URL supplies the administrative connection. It needs permission to create
the database and temporary role, grant that role to the administrator, reassign
its objects and remove it. The local Compose account has these privileges.
Existing targets, the connected database and system databases are refused.
The command never uses pg_restore --create or --clean.

Only pass --trust-source for a backup from a trusted server. Archives contain
executable SQL; checksums establish integrity, not author trust. The restore
logs in as a new owner with no superuser, database/role creation, replication or
row-security-bypass privileges. This limits privilege but is not a sandbox for
hostile archives or an isolation guarantee on a shared cluster.

Restore runs in one transaction. Verification checks every table's row
fingerprints, schema definitions including immutable triggers, migrations,
sequence floors, and the actual SHA-256 of every original file. Ownership and
grants are intentionally not copied. After verification, ownership passes to the
administrator and the temporary role is removed. The JSON receipt includes the
backup ID, target/schema, archive hash, verification time, table/row/original
totals and zero provider calls. Save it privately with the backup.

Failure leaves the newly created target quarantined with connections disabled
and its temporary role unable to log in. Existing databases are never dropped.
Cleanup failures are reported explicitly. A killed process or machine can prevent
cleanup: inspect the target and its rc_restore_ owner before any use. Remove only
that confirmed failed target/role through normal database administration; do not
enable a failed target to bypass verification.

Restore does not edit .env or switch the live application. To inspect a verified
target, stop the app, select its database and schema in the environment, and start
compatible code. Confirm the selected database before approving or recovering
runs. Keep the source and verified copy until the recovery decision is complete.

## Upgrade and rollback

1. Stop the workbench and workers. Check active or uncertain provider requests;
   restoring a database cannot undo a remote request.
2. Back up with the currently deployed code and verify a restore into a new
   rehearsal database. Retain its manifest, receipt and compatible code.
3. Apply pnpm db:migrate to the rehearsal with proposed code. Validate readiness
   and relevant tests before migrating the live database.
4. On failure, inspect which migrations committed. Each application migration is
   transactional, but earlier migrations may already have committed. LangGraph
   has its own migration history. Never edit applied checksums or assume switching
   code back reverses the schema.
5. For rollback, stop execution, use pre-upgrade code and restore the saved backup
   into another new database. After verification and review, explicitly select
   that database and restart. Later data is absent and requires a separate
   reconciliation decision.

Tests cover a partially committed synthetic upgrade, rollback of its failing
migration and restoration of compatible code. They restore saved reports,
evaluations, binary originals and a paused run, resume the synthetic workflow,
and verify that an uncertain model attempt is never sent again.

## Scope

This is a local application-schema recovery workflow, tested with the pinned
PostgreSQL 18 image. It is not continuous point-in-time recovery or a cluster
backup. Roles, grants, server configuration, other schemas and external
dependencies are excluded. Foreign tables and cycling/nonstandard sequences are
refused. Missing cross-schema dependencies make restore fail. Client operations
and verification statements each have a five-minute limit.

Protected ChatGPT credentials remain outside PostgreSQL. On the same machine and
user account, the existing connection stays separate from database recovery.
On a new machine, reconnect using pnpm provider:login and review the intended
account's plan/credit settings. Copying Windows DPAPI files is not portable
sign-in recovery.

Shared hosting still needs managed backups/PITR, an encrypted off-machine copy,
explicit retention and recovery objectives after workload and hosting review.
[Issue #9](https://github.com/andersj05/ResearchChain/issues/9) remains open.

References: PostgreSQL's
[pg_dump snapshot semantics](https://www.postgresql.org/docs/18/app-pgdump.html),
[pg_restore execution rules](https://www.postgresql.org/docs/18/app-pgrestore.html)
and [ownership reassignment](https://www.postgresql.org/docs/18/sql-reassign-owned.html).
