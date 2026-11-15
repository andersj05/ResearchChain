# Evaluation workbench

Open **Evaluations** in the workbench. No evaluation action automatically calls a
provider, creates a human label, tunes a model, or publishes a report.

## A first comparison

1. Capture permitted source material in **Evidence**. Add any reference report in
   **Evaluations → References**, separately from allowed evidence. The EquityCats
   anchor article is development-only material.
2. Create a dataset with a task brief, topic identifier, partition and evidence
   snapshots. Choose **Frozen-evidence writing** for identical source sets, or
   **Full research** for complete research outputs that may add sources to the
   required starting set. Keep these tracks separate when interpreting results.
3. Inspect input checks. A generation packet is downloadable only when those
   checks pass. Complete captured UTF-8 source text is included; images and PDFs
   retain content addresses and require the original artifact store. Reference
   outputs and their identifiers are excluded from the packet.
4. Add two candidate outputs. Select a completed research attempt to capture its
   recorded workflow, model, prompts, requests and sources. Alternatively paste a
   draft and its complete generation input, source IDs and declared versions.
   Imported provenance is a declaration, not verified execution history.
5. Select the two candidates and create a blind comparison. The server saves a
   randomized A/B assignment. Candidate/model/workflow identities and reference
   reports are absent from the blind response until a judgment is saved.
6. Inspect the drafts and sources, record factual/numerical/citation gates and
   reasons, and optionally rate writing dimensions. Select text in either draft
   and use **Edit selected text** to record a replacement and reason. Offsets count
   Unicode code points; the server checks the original span and rejects overlaps.
7. Submit a preference, tie or abstention with a reason. Saving reveals provenance
   and the reference reports. It permanently records the label; retrying the same
   submission is safe. Failed or unassessed gates prevent qualification regardless
   of preference. Writing ratings never replace those gates.

An owner who set up the candidates may recognize their texts. This is a blind
review interface, not an access-control boundary against the local workspace
owner. Use a reviewer who has not seen the candidate identities or judge predictions
when collecting independent labels. Source content remains untrusted material.

## Versions, splits and historical cases

Dataset edits create a new revision with an immutable predecessor. Only one
successor can replace a revision; stale edits must refresh. Candidate text,
comparison assignment, feedback and predictions are immutable. Repeated pairs of
the same texts within a case revision cannot produce a second review by importing
new candidate IDs.

Development and holdout cases cannot share evidence IDs/content hashes, reference
content hashes, or the same declared topic with overlapping or unknown periods.
A topic identifier is an owner declaration, not automatic semantic topic detection.
The anchor reference cannot be promoted to a holdout. Keep separate real topics
or periods; a synthetic fixture is not evidence of research quality.

Historical cases require both a period start and an as-of cutoff. Dates use whole
UTC calendar days; intraday release-time leakage is not checked. Publication and
data dates after the cutoff fail. Missing publication dates, missing numeric-data
vintages, unavailable content, and captures made after the cutoff are unknown and
block generation export. Parent and correction lineage are checked too. A declared
retrieval date does not backdate the server's captured bytes. There is currently no
archive-proof adjudication workflow for material first captured after its cutoff.

Reference checks use registered source lineage, original content hashes and exact
or substantial copied passages, including nested JSON prompts and earlier recorded
research requests. They are conservative metadata/copy checks: they can flag shared
quotations and cannot detect all paraphrases or unregistered references. They do not
prove semantic truth, source independence, or an absence of all contamination.
The registry hash used for each check is saved. New references trigger a recheck
when a comparison is created; an already saved review retains its original checks.

## Judge calibration

An existing external judge prediction can be registered before human feedback,
with its model, exact prompt/version, reason and probabilities for A, B and tie.
Probabilities must be finite and sum to one. The exact prompt is hashed; a judge
configuration gets one prediction per pair. New predictions cannot be added after
the human label is revealed. Saving a prediction does not call a model, and saved
predictions are hidden from the review view until feedback is submitted.

Calibration groups by model, prompt/version, track and partition. It reports
preference agreement and three-class Brier score (sum of squared probability
errors, range 0–2). An exact tie for largest probability uses the fixed A/B/tie
order for agreement; Brier uses all three probabilities. These metrics measure
agreement with the saved human preference, not factual correctness.

Synthetic cases, synthetic candidates/labels, abstentions, unlabeled comparisons,
and failed or unknown input checks are excluded. Imported archives never enter
local calibration. At least 20 eligible pairs across five distinct cases are
required to begin exploratory calibration. This is a minimum collection threshold,
not a statistical guarantee of reliability. There are no real human labels seeded
by the implementation and no claim of a calibrated judge or reliable holdout score.

## Portable comparisons

After review, **Download comparison** exports the immutable dataset, candidate
texts, source metadata/content hashes, versions, references, human feedback and
registered judge predictions. The bundle has a canonical checksum. It reconstructs
the saved comparison; it is not a backup of all original source files, run requests
or executable workflows and cannot by itself rerun a model.

**Archives → Import comparison JSON** verifies internal checksums, identities,
text spans, context and label consistency. Imports are read-only and explicitly
unverified: a checksum does not authenticate who produced a label or model output.
They do not create local cases, human labels or calibration samples. Private
comparison exports belong outside this public Git repository.

## Scope

Migration `0006_evaluations.sql` adds the immutable evaluation tables. Python models
own the generated API contract. Tests use synthetic sources and an injected provider
in isolated schemas. The workbench supports reference registration, versioned cases,
recorded/imported candidates, blind judgments, judges, calibration and archives.
Real held-out topic collection, independent human labeling and calibrated judge
assessment still require an actual evaluation study. No fine-tuning or score-only
optimization is implemented.
