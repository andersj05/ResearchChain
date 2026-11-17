# ADR 0008: Immutable editorial revisions over recorded research

Status: accepted.

## Context

Research results need human section-level drafting, evidence inspection, style
guidance and editorial review without changing the recorded research run.
Acceptance and preferences must stay attached to the content that was reviewed.

## Decision

Store reports, style guides and feedback in separate append-only tables. A report
series has one successor per revision, with an advisory lock and unique constraint
preventing lost updates. Request IDs return the original receipt on retry and
reject reuse with different inputs. Database triggers prohibit rewrites.

Seed from a completed recorded attempt and preserve its result, input/output
artifact addresses, manifest and workflow hash. Later revisions identify human
authorship and retain section edit hashes. Sources are immutable snapshots.
The API checks ownership in the report source set, actual representation and
exact quotations; it does not claim semantic verification.

Pin one immutable style-guide revision per report revision. The guide includes
analytical and voice examples and remains editorial development material.
The editor makes no new provider request. Future model-assisted drafting must
have explicit invocation, pinned inputs, durable attempt accounting and the
approved provider/usage controls; it is not an implicit side effect of saving.

Bind feedback to exact report and section hashes and Unicode code-point spans.
Preferences name the immediate predecessor and its hash. Whole-report decisions
are distinct from section decisions, and new report revisions never inherit
acceptance. Feedback records identify human authorship and do not grant training
consent or populate the evaluation dataset.

Keep per-revision browser recovery drafts and pending save receipts. A conflict
preserves the draft for manual reconciliation rather than attempting an
unreviewed automatic merge. Export an escaped offline HTML/JSON/originals bundle;
publication remains a separate user action.

## Consequences

Prior reviews remain reproducible after editing, and retries cannot duplicate
successful saves. Source classifications and analytical quality still require
human judgment. Browser recovery is local and storage-limited, not a backup.
The bundle is a review artifact, not a complete runtime archive. This remains a
local owner workbench; remote multi-user identity and publication workflows
require a separate design.
