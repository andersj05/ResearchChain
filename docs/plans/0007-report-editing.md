# Report editing and structured feedback

Next implementation after the evaluation workbench, tracked in
[issue #8](https://github.com/andersj05/ResearchChain/issues/8).

## Usable editorial workflow

Create a detailed editable report from a saved research result, keeping its run,
workflow, prompt, model and source provenance. Support ordered sections, headings,
human drafting/revision, and visible source references and chart originals. Label
facts, interpretations and speculative scenarios explicitly without presenting a
human-selected label as automatic fact verification.

Persist immutable report revisions with optimistic concurrency and idempotent save
receipts. Keep unsaved edits visible and recoverable. A new revision must not change
a previously reviewed report or inherit acceptance silently.

## Structured feedback and style

Capture human edits, anchored comments, preference labels and accept/reject decisions
against exact report/section versions and text hashes. Use the evaluation conventions
for Unicode spans and provenance. Preserve reasons, distinguish automated suggestions
from human judgments, and never convert either into training data automatically.

Version style guides separately and pin one to each report revision. Include analytical
structure, source discipline, alternative explanations, scenarios and editing guidance
as well as prose voice. Treat the EquityCats anchor as development material; do not
copy reference outputs into held-out generation requests. Human feedback remains
necessary to validate voice and analytical quality.

## Export and execution boundaries

Produce a reviewable report export with source references, charts where supported,
revision metadata and explicit review status. Publication remains a separate human
action. Do not add public hosting, trading or automatic model usage as editor scaffolding.
Any provider-backed section drafting must be explicit, reuse the approved ChatGPT-plan
connection and durable attempt/limit accounting, and retain the in-flight token-limit
caveat. Preserve the owner's no-paid-API-fallback preference.

## Validation

Test version conflicts, retry safety, source ownership/provenance, comment/span binding,
review invalidation on new revisions, style-version pinning, and safe export rendering.
Exercise section editing, source/chart inspection, feedback, refresh/recovery and export
on desktop/mobile. Regenerate contracts, run required checks, keep coherent frequent
commits, and merge completed slices into dev only after CI.
