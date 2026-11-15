# Portable encrypted backup recovery

[Issue #9](https://github.com/andersj05/ResearchChain/issues/9).
Base: dev 258e736 after in-app ChatGPT reconnect PR #32.

## Outcome

A verified local research backup can be packaged as a standard age-encrypted tar
archive, copied to an owner-selected off-machine destination, and recovered on
another machine with an encrypted recovery key and its passphrase.

Implement and test the packaging/recovery workflow first. A destination question
is pending. Do not upload private research or generate a real owner recovery key
until its destination/key handling is concrete. Synthetic test keys are disposable.
No provider inference, public deployment or automatic backup deletion is needed.

## Design

- Use pyrage's standard age implementation and streaming IO. Encrypt both the
  existing manifest and database.dump; do not invent an encryption algorithm.
- Generate an X25519 recovery identity locally, protect the small identity with
  age passphrase encryption, and write only the public recipient separately.
  Read/confirm the passphrase through a hidden terminal prompt, never arguments,
  environment variables, logs or chat. Fail closed if hidden input is unavailable.
- Encrypt a two-member standard tar payload to the public recipient. Public-key
  encryption permits later backups without exposing the recovery identity.
- Unseal into a fresh private directory. Fully authenticate the payload before
  reading its archive entries. Permit exactly manifest.json and database.dump;
  reject paths, links, extensions, sparse files, duplicates and extra entries.
- Verify the recovered manifest and archive hash/size before publishing its
  manifest. The existing explicit trusted-source, new-database restore remains
  required. Encryption authenticates contents, not the archive's author.
- Stream file data, cap key/manifest/header reads, preserve restrictive Unix modes
  and Windows ACLs, refuse overwrite/symlink targets, publish success last, and
  remove only explicitly owned temporary files on failure.
- Keep originals and credentials unchanged. Provider/owner credentials stay
  outside research archives. Record only redacted receipts and public metadata.

## Verification

Use disposable keys, directories and test_ schemas. Cover key round-trips,
wrong passwords/identities, tampering/truncation, incomplete/mutated input,
write failures, safe archive extraction, file permissions and bounded streaming.
Rehearse encrypted backup → unseal → existing verified new-database restore
with synthetic research and originals. Test interoperability with standard age
payloads and tar tooling. Run pnpm check and exact-head CI before merging to dev.
Off-machine storage is not complete until an actual chosen copy and recovery are
verified; keep that distinction explicit.

Sources: [pyrage 1.4.0](https://pypi.org/project/pyrage/1.4.0/),
[age specification](https://age-encryption.org/v1),
[Python tar format](https://docs.python.org/3.12/library/tarfile.html).
