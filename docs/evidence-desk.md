# Evidence desk

Apply the current migrations with `pnpm db:migrate`, then open **Evidence** in the
local workbench. Originals, source metadata, and claims live in Postgres and survive
API restarts. They are not browser-only drafts.

## Capture and inspect a source

Choose **Add source** and upload a permitted file (up to 20 MiB), paste text or
CSV/TSV data, or register a link. Recording a URL does not fetch its website. Use
**Link only**, **Missing**, or **Paywalled** when you have not captured the original.
Those records have no content hash; publication, retrieval, and as-of dates stay
unknown unless you supply them.

Record authorship, publisher, dates, access rights, page/section, and excerpt under
**Provenance, dates & location**. The original's storage timestamp records when its
bytes were first stored, not when a remote website was retrieved. Rights and dates
are supplied metadata, not independently verified facts.

Inspect safe image previews, plain text, and bounded table previews. **Download
original** returns the exact captured bytes. PDFs and other formats are downloaded
for inspection; this milestone does not extract report text or run OCR. Original
HTML, SVG, and retrieved instructions are never executed in the workbench.

## Charts and numbers

| Representation     | Meaning and requirements                                                            |
| ------------------ | ----------------------------------------------------------------------------------- |
| Original source    | Captured material or an explicitly uncaptured reference.                            |
| Chart screenshot   | PNG, JPEG, or WebP original; image pixels are not numeric observations.             |
| OCR interpretation | Supplied UTF-8 interpretation linked to a captured parent with a method.            |
| Digitized estimate | CSV/TSV values linked to a captured parent, with method, units, and uncertainty.    |
| Numeric data       | UTF-8 CSV/TSV source table with units and a reproducible source/method description. |

Table inspection validates headers, row shape, and at least one finite numeric
column. Values remain strings so precision is preserved. Limits are 128 columns,
100,000 rows, and 10,000 characters per cell. Previews show at most 12 rows and
240 characters per cell; download the original for all values. A parser label
records the table-inspection version. Passing this check does not establish that
the data or an associated financial claim is true.

Declared screenshot/interpretation/estimate ancestry cannot be relabelled as numeric
source data, including through an intermediate record or a corrected version.
Unlinked source descriptions still rely on the user's provenance declaration.

## Claims, corrections, and runs

Use **Add claim** to save a hypothesis, observation, or interpretation. Add separate
supporting, contradicting, and contextual links with their rationale and location.
Unavailable sources remain visibly unavailable; linking one does not imply it was
read. Claims remain separate from generated report prose.

**Correct provenance** and **Revise claim** create immutable new versions. Earlier
records remain inspectable. Select sources in **Run workflow** to pin those exact
versions. Later corrections do not change an existing run. Captured originals are
verified for new runs; older accepted run manifests and retry receipts remain
compatible even when an old address has no stored original.

Source and claim lists load 50 records at a time; use **Load more** for older
entries. Search filters loaded sources. Selection remains visible when reopening
run setup even if newer records move it beyond the first page.

[Research workflows](hypothesis-research.md) can read pinned captured originals
through the connected ChatGPT plan, with bounded inputs, recorded attempts and
human review. Source links do not automatically fetch websites; capture additional
evidence before starting a new run. See [request allowances](request-allowance.md)
for the shared admission limit and [owner access](owner-access.md) for the local
workspace boundary. [ADR 0004](decisions/0004-evidence-provenance.md) records the
original storage decision.
