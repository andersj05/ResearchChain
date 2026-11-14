# Evidence and chart provenance (issue #5)

Editor PR #21 is merged into dev at `1f05f58`. Work on `feat/evidence-provenance`.
The owner has authorized frequent coherent commits and merging completed stages
into dev after required local checks and CI.

1. Define immutable evidence records and bounded content-addressed blob storage.
   Existing ArtifactRef is only sha256 ID/media type/name. Use a migration and
   generated Python/OpenAPI contracts. Evaluate bounded Postgres bytea storage
   for the local baseline: atomic metadata+bytes and isolated tests, with a storage
   adapter boundary for later object storage. Record actual SHA-256, byte size,
   media type, original name, and timestamp without paths derived from filenames.
2. Evidence provenance includes optional original URL/author/publisher, supplied
   publication/as-of dates, actual retrieval/capture timestamps, access status and
   rights, excerpt/page location, source kind, and parent/derivation relation.
   Unknown values stay unknown. A link record without captured content must not
   claim a retrieved content hash. Missing/paywalled entries remain visible.
3. Store screenshot, supplied OCR interpretation, digitized estimate, and numeric
   dataset as distinct representations. Keep supplied methods, units, uncertainty,
   and lineage; never imply an OCR/estimation or reproduction operation occurred
   merely because a file was uploaded. Original bytes remain inspectable.
4. Add durable claims with supporting/contradicting evidence links and locations.
   Corrections create new evidence records/versions; pinned snapshots and existing
   run manifests retain their original content and provenance.
5. Add an Evidence tab and forms for permitted uploads, supplied text/excerpts,
   link-only records, metadata, original download/preview, and claim relationships.
   URL registration does not silently fetch websites. Provider selection follows
   coverage/access testing in the explicit live-research milestone.
6. Add evidence/artifact selection to run setup. Verify actual availability for new
   content references while preserving legacy stored manifests and retries.
   RunStore.start compares artifact dictionaries produced by model_dump() with the
   stored array. Preserve the ArtifactRef wire shape: new default fields would
   break retries against existing manifests. Keep provenance associations separate
   and test old accepted requests and responses explicitly.
7. Treat captured content as data. No execution of retrieved instructions or HTML.
   Constrain size/type, use generated content-addressed identifiers, render text as
   text, and serve unsafe originals as downloads with nosniff. Tests must isolate
   bytes/metadata and contain synthetic or openly reusable material only.
8. Verify provenance and numeric distinctions, immutable/hash-addressed retrieval,
   invalid/missing data, concurrent deduplication, original inspection, claim links,
   pinned run associations, and browser flow/refresh. Run full checks, review the
   UI, commit coherently/frequently, and merge the completed issue into dev.

These are implementation notes to refine against the code, not a claim that the
pipeline is implemented. No providers, credentials, or paid calls are configured.
