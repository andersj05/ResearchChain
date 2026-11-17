# Reports and editorial review

Open **Reports** in the workbench. Create a style guide, then start a report from
a completed research attempt. The first revision preserves the recorded conclusion,
hypotheses, alternatives, falsifiers, limitations and evidence requests, together
with the original run, model, workflow and prompt provenance.

Report creation copies a saved result. Section drafting and revision are human
editing actions. The pinned guide is an editorial reference; it does not
automatically rewrite the seed or demonstrate that the report matches the owner's
voice. Research review and report review are separate decisions.

## Draft and save

Select a section to edit its heading, text and classification. Add, reorder,
remove or restore a section. The three classifications are established fact,
interpretation and speculative scenario. Split mixed claims into separate sections
when they need different labels. A fact section needs captured supporting evidence,
but the label and citation presence do not verify its truth.

Attach source references with a location, relationship, rationale and optional
exact quotation. The server checks quoted text against the captured original and
preserves source representation, including inherited chart-derived uncertainty.
Uncaptured or unsupported sources provide context only. Select captured PNG, JPEG
or WebP originals to display charts. Inspect dated provenance and numerical
originals in the source panel; save newly added sources before citing them.

Every save needs a change note and creates an immutable successor. Existing source
snapshots remain available; additional sources can be pinned. Titles, ordering,
classifications, citations, charts and style-guide changes are versioned.
The editor supports up to 40 sections, 60,000 characters per section, 200,000 body
characters per report, 100 sources and 64 MB of source originals.

Unsaved report edits are retained in this browser, separately for each saved
revision. Download the draft JSON if browser storage is unavailable or to keep a
manual copy. A pending save retains its request ID across refresh so a lost
response can be retried without duplicating a revision. Concurrent saves cannot
overwrite each other. On conflict, keep the local draft, open the latest revision,
and reapply the intended changes. Draft JSON is a recovery copy; this milestone
does not include a report-import or automatic merge feature.

## Style guides and feedback

Version analytical structure, source discipline, scenarios and prose voice,
including separate structure and voice examples. The starting guide contains
general illustrative guidance, not approved EquityCats prose. A new guide version
does not change reports that already pin an earlier version. Guides are designated
editorial development material and are not injected into evaluation inputs.

Feedback targets an exact saved report or section hash. Select saved section text
to anchor a comment; spans use Unicode code points. Record reasons with accept or
reject decisions and preferences against the immediate predecessor. Both versions
are retained for comparisons. Section decisions do not set whole-report acceptance.
A later decision on the same revision is appended, preserving its earlier history.
Any new report revision starts unreviewed, including a style-only revision.

Human feedback is explicitly identified and carries no automatic training consent.
It does not create evaluation labels, judge calibration samples or fine-tuning data.
Report acceptance is an editorial judgment, not a fact-checking certification.

## Review export

Export a saved revision as a ZIP with an offline `index.html`, a structured
`report.json` and the captured source originals. The HTML escapes supplied text,
shows classifications, quotations, charts, dated sources, exact review status and
the pinned guide. Original bytes retain their content hashes. Files use controlled
content-addressed paths, and the HTML disables scripts and external resource loads.

The bundle records the current head at export, so an older accepted revision is
not confused with a newer draft. It contains current source originals and seed
provenance, not the full workflow runtime or every report revision. Keep private
sources and exports out of the public repository. Export does not publish a report.
