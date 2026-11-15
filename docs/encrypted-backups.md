# Portable encrypted backups

The backup CLI can encrypt a complete ResearchChain backup as a standard age v1
file. Both the database dump and its manifest are inside the encrypted payload.
A passphrase-protected recovery identity makes it portable to another computer.
These commands operate on files; they do not contact a model or restore a database.

## Create a recovery key

Run this in a local interactive terminal from the repository root:

```text
pnpm db:keygen --output .local/recovery-key
```

Enter and confirm a long, unique recovery passphrase at the hidden prompts
(at least 16 characters). The command refuses an echoed or redirected prompt.
Never put the passphrase in command arguments, an environment variable or chat.

The new private directory contains identity.age (the encrypted recovery identity)
and recipient.txt (its public recipient). The passphrase is not stored.
Keep a recoverable copy of identity.age separately from the research backup and
keep its passphrase in your password manager or another appropriate separate
location. Losing either prevents recovery; creating a new key cannot unlock old
copies. Retain old identities while backups still depend on them.

The public recipient can stay on the backup machine. Creating later encrypted
backups needs only that public file, not the identity or passphrase.

## Encrypt a complete backup

First create a normal consistent backup using the existing procedure:

```text
pnpm db:backup --output .local/backup-source
pnpm db:seal --input .local/backup-source --output .local/backup-encrypted --recipient .local/recovery-key/recipient.txt
```

Destinations must be new and their parent directories must exist. The command
verifies the dump size and the hash of bytes actually packed before encryption.
Input files and the local plaintext backup remain unchanged.

A successful encrypted directory contains:

- backup.tar.age: the encrypted manifest.json and database.dump.
- sealed.json: a completion receipt with ciphertext size/hash, public recipient,
  timestamp and format. It contains no source schema, private filenames or contents.

The encrypted file is streamed and synced before the completion receipt is
written. Do not treat an incomplete directory as a successful backup. Copy the
encrypted package to the chosen recovery destination, compare its ciphertext hash
with the trusted receipt, and test recovery from that copied file.

No destination, upload, schedule or automatic deletion is configured by these
commands. Off-machine recovery is complete only after an actual separate copy
and a successful recovery rehearsal. Keep the original verified backup until
the recovery decision is made.

## Authenticate, unpack and restore

On the recovery machine, use the compatible ResearchChain checkout and locked
dependencies. Run:

```text
pnpm db:unseal --input .local/backup-encrypted/backup.tar.age --output .local/recovered-backup --identity .local/recovery-key/identity.age
```

Enter the recovery identity's passphrase at the hidden prompt. The command fully
authenticates the age payload before parsing archive entries. It accepts exactly
the two expected ordinary files, checks their sizes and the dump hash, and
publishes a usable manifest only after the recovered dump is synced.

A successful unpack is **not a tested database restore**. Follow the existing
[new-database restore procedure](backups.md):

```text
pnpm db:restore --input .local/recovered-backup --database researchchain_rehearsal --trust-source
```

Only use --trust-source for a backup from a trusted server. Anyone with the public
recipient can encrypt a file addressed to you. Encryption protects content
integrity and confidentiality; it does not establish the SQL archive's author.
The existing restricted restore, schema checks, original-byte verification and
worker recovery holds remain required. No command switches the live database,
approves a review or replays a provider call.

Provider credentials, owner password/session state and [monitor profiles](monitoring.md)
remain outside research archives. On a new machine, enroll owner access, reconnect
ChatGPT and configure any operational monitor separately.

## File handling and limits

Private directories use an owner-only inheritable ACL on Windows and mode 700
on Unix; created files use mode 600 on Unix. Recovery paths reject symbolic links
and junctions. Existing destinations and output filenames are not overwritten.
Failures and normal interruption remove only files created by that invocation.

Private staging files temporarily contain plaintext. A forced process kill or
machine failure may leave them in the private destination directory; inspect that
specific failed directory before manually cleaning it up. This is not secure erase.

Large payloads are streamed. Staging needs roughly twice the archive's disk space,
plus overhead; insufficient space and failed writes fail without a success receipt.
Key files, age headers and manifests have bounded reads. The tar reader permits
ordinary GNU/USTAR file headers for exactly manifest.json and database.dump;
paths, links, sparse/PAX extensions, duplicates and extra entries are rejected.

Recovery identities use X25519 and standard age passphrase protection. Only one
public X25519 recipient is accepted; SSH keys and executable age plugins are not
part of this workflow. The pinned pyrage implementation performs the cryptography.
The full payload is a standard age-encrypted GNU tar, so the container is not
dependent on Windows DPAPI or proprietary cryptographic primitives.

The automated rehearsal encrypts a real synthetic PostgreSQL backup, unpacks it,
restores into a new disposable database, verifies original bytes and the paused
run, and leaves the source unchanged. Other tests cover wrong keys/passwords,
tampering, truncation, malicious tar entries, bounded IO, output collisions and
interruption. All keys and research used by tests are synthetic.

See [ADR 0014](decisions/0014-portable-encrypted-backups.md) and
[issue #9](https://github.com/andersj05/ResearchChain/issues/9).
