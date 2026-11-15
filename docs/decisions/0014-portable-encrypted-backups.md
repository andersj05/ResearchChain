# ADR 0014: Portable encrypted research backups

Status: accepted for the local recovery workflow, 2026-11-15.

## Context

The verified backup/restore workflow produces a private plaintext PostgreSQL dump
and manifest. Off-machine copies must protect both and remain recoverable after
loss of the original computer. Windows DPAPI provider credentials are deliberately
outside the archive and cannot serve as a portable backup decryption key.

## Decision

Use pinned pyrage 1.4.0, the Rust age implementation's Python bindings. Generate a
local X25519 recovery identity and encrypt its small serialized secret using age
passphrase protection. Prompt only through a hidden interactive terminal. Store
the public recipient separately so later backups do not need the private identity.

Package the existing manifest and database.dump as two ordinary GNU tar members,
then stream age encryption to that public recipient. The manifest is encrypted
alongside the research, rather than exposing schema/row fingerprints in a sidecar.
A public completion receipt records only ciphertext metadata and the recipient.

Recovery first authenticates the complete age stream into private staging, then
parses exactly two bounded ordinary tar headers. It never follows archive paths,
links, sparse metadata or extension records. It verifies the recovered dump hash
and size before completing the output manifest. This does not execute SQL.

Continue to require explicit source trust and the existing new-database verified
restore. Encryption does not authenticate the archive's author. Provider identity,
owner access state, live database selection and run recovery remain separate.

## Consequences

The format is portable and uses established age cryptography. The complete payload
streams through the binding; only the small encrypted identity uses its byte API.
The binding and matching type stubs are locked dependencies with Windows/Linux
wheels; local and CI tests exercise those two platforms.

An encrypted recovery identity and its passphrase must both survive machine loss.
The owner must retain them separately and preserve old keys for old backups.
No default owner passphrase, plaintext key file, automatic upload or key deletion
is introduced. Actual off-machine destination/copy/recovery remains an explicit
operational step after implementation.

Private staging costs disk space and may survive a hard kill. All output creation
is exclusive; success is recorded last. Normal failure cleanup tracks only files
created by the invocation, preserving filename collisions and unrelated files.
This workflow adds neither a database migration nor a provider inference call.

Sources: [pyrage](https://github.com/woodruffw/pyrage),
[age v1](https://age-encryption.org/v1),
[tarfile formats](https://docs.python.org/3.12/library/tarfile.html).
