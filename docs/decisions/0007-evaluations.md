# 0007: Immutable evaluation cases and blind judgments

Status: accepted for the local evaluation implementation.

## Context

Writing resemblance and agreement with a development exemplar are insufficient
measures of research quality. We need stable generation inputs, separate holdouts,
visible evidence limits, and human feedback that automated judges cannot overwrite.

## Decision

Use append-only Postgres records for reference outputs, dataset revisions,
candidates, randomized comparisons, human labels and imported judge predictions.
Keep reference outputs outside generation packets. Freeze checks and the reference
registry hash at comparison creation. Unknown historical vintages are ineligible.
Python contracts remain authoritative and all source content remains untrusted.

Record exact texts and hashes. Bind feedback to both displayed hashes; validate
edited spans using Unicode code points. Reveal provenance after an immutable human
submission. Deduplicate unordered text pairs within a case revision. The local
workspace owner can inspect setup data, so blinding is an interface property rather
than an authorization boundary.

Keep factual/numerical/citation gates separate from preferences and writing ratings.
Imported judge predictions must precede the human label. Calibration separates
model/prompt/track/partition and excludes synthetic, abstained, unknown-input and
unlabeled pairs. Do not manufacture human feedback or run incidental paid judges.

Portable bundles reproduce a saved comparison, not an entire executable research
run. Check internal consistency and store imports as unverified archives that cannot
contribute labels to local calibration. Original artifact storage remains necessary
for source retrieval or execution reproduction.

## Consequences

Evaluations remain inspectable across workflow revisions and interrupted requests.
Source metadata and copy detection are conservative and cannot prove semantic
independence. Late references do not rewrite historical labels. An independent
reviewer and a real held-out collection are still needed before drawing quality or
calibration conclusions. See [the evaluation guide](../evaluations.md).
