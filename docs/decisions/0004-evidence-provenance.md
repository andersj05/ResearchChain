# ADR 0004: Immutable originals and evidence provenance

Status: accepted for the local evidence milestone, 2026-11-14.

## Storage and identity

Store originals as immutable Postgres `bytea`, bounded to 20 MiB each and addressed
by SHA-256 of the actual bytes. Keep metadata, claims, and run associations in the
same database so a backup captures them together. This avoids adding object-store
credentials and lifecycle coordination to the local baseline. `ArtifactStore`
provides a storage boundary for a later object-store implementation.

The first upload of identical bytes supplies the canonical artifact filename and
media type. Filenames are metadata, never filesystem paths. Numeric parsing takes
an explicit CSV/TSV format from the evidence record, independent of that first
filename. Text capture creates a UTF-8 original; link registration never fetches
remote content or invents a content hash or retrieval date.

Evidence and claims have caller-supplied UUIDs and canonical request hashes. A retry
returns the same immutable record; a changed request under the same ID conflicts.
Transaction advisory locks serialize identical IDs. Corrections create a new record
with `replaces_id`; derivations have `parent_id`. Database triggers reject updates
and deletes. The local baseline retains all records and originals, including uploads
not yet linked to evidence. Quotas, retention, authorization, and backup operations
remain prerequisites for remote hosting.

## Provenance and interpretation

Keep author/publisher, URL, publication/retrieval/as-of dates, rights, source location,
method, units, and uncertainty explicit. Unknown information remains unknown.
`captured_at` is the original's storage timestamp, not proof of remote retrieval.
Access rights and supplied dates are user attestations, not independently verified
permissions or source facts. Missing and paywalled sources can remain in a run with
no captured content.

Original material, chart screenshots, supplied OCR interpretations, digitized
estimates, and numeric source tables are separate representations. This milestone
performs no automatic OCR or chart extraction. CSV/TSV inspection validates table
shape and finite numeric columns while preserving string precision. Previews are
bounded; originals retain every byte. Chart-derived ancestry must remain labelled
as estimates rather than being promoted to source numeric data through a correction
or intermediate record. This validates declared lineage, not the truthfulness of
an unlinked source description.

Claims retain supporting, contradicting, and contextual relationships with source
locations and rationale. A relationship expresses a supplied judgment; it does not
verify the claim or imply that a missing source was read.

## Execution and display

New runs verify explicitly supplied artifact metadata and availability, derive
captured originals from selected evidence, and pin immutable evidence IDs in a
separate association table. Keep the existing `ArtifactRef` wire shape. Previously
accepted manifests and command receipts remain readable and retryable even when
an old artifact reference has no stored original.

Render supplied text as text. Serve original bytes with `nosniff`, a restrictive
content-security policy, and attachment disposition except for explicitly requested
PNG/JPEG/WebP previews. HTML and SVG are not executed. No retrieved source becomes
an instruction or executable workflow definition. Model/provider integration is a
separate milestone with its own context boundary and budget controls.
