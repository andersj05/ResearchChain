# Evaluation datasets and blind comparisons

Next implementation after research [PR #24](https://github.com/andersj05/ResearchChain/pull/24),
tracked in [issue #7](https://github.com/andersj05/ResearchChain/issues/7).

## First usable slice

Create versioned evaluation cases and compare two pinned outputs without showing
which model or workflow produced each one until the reviewer submits a preference.
Collect a reason and exact edited spans. Start with synthetic fixtures for automated
tests and the existing pilot as development material. Do not manufacture human
preferences or describe development cases as held-out observations.

## Data and execution boundaries

- Cases distinguish development and holdout topics/time periods, task type, brief,
  as-of cutoff, frozen evidence IDs, and separately stored reference outputs.
  Generation inputs are assembled from an explicit allowlist excluding references.
- Historical tests check publication/as-of metadata and snapshot availability.
  Missing dates/vintages are unknown, not a passed leakage check. A source label or
  retrieval timestamp does not establish that information existed at the cutoff.
- Keep frozen-evidence writing comparisons separate from complete-research runs.
  Frozen comparisons require matching evidence snapshots. Complete-research
  comparisons preserve their distinct retrieval/manifests and remain a separate track.
- Pin candidate text/artifacts and workflow/prompt/model/data versions. Changes create
  new versions; do not mutate an evaluated candidate. Display source links without
  exposing the hidden candidate/provider mapping in the blind comparison payload.
- Save randomized left/right assignment server-side. Bind feedback to the exact
  comparison and text hashes; prevent a repeated submit from relabeling another pair.
  Reveal provenance after the submitted preference. Record ties and abstentions.

## Quality and feedback

Factual/numerical accuracy and citation support are gates. Structure and quotation
checks alone are insufficient to pass them. Distinguish pass, fail and unassessed,
and store supporting reasons/evidence. Rate analytical depth, counterarguments,
scenarios, clarity, voice and edit burden separately from those gates.

Changed spans must address the saved candidate text exactly, with explicit Unicode
indexing. Keep human labels distinct from automated judge outputs. Compute calibration
only against actual saved human labels; expose insufficient data honestly. Do not
optimize a single judge score or begin fine-tuning before a reliable baseline exists.

Implement reproducible comparison export/import and calibration summaries after the
case/feedback path works. Avoid incidental live judge calls; any provider-backed
judge uses the same explicit run admission and accounting boundaries as research.

## Verification and delivery

Test reference exclusion, as-of failures/unknowns, immutable versions, blind payloads,
review idempotency, exact edited spans and frozen-evidence mismatches. Cover the
case/comparison/reveal interactions in the browser on desktop and mobile. Regenerate
contracts, run required checks, commit coherent steps frequently, and merge each
completed implementation slice into dev after CI. Real human preference collection
remains a user interaction; synthetic test labels are never calibration evidence.
