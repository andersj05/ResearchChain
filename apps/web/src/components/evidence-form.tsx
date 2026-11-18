"use client";

import { useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { api } from "@/lib/workflow";
import {
  representationLabels,
  rightsLabels,
  uploadOriginal,
  type EvidenceCreate,
  type EvidenceRecord,
} from "@/lib/evidence";

export function EvidenceForm({
  sources,
  original,
  attachChart = false,
  onSavingChange,
  onSaved,
  onCancel,
}: {
  sources: EvidenceRecord[];
  original?: EvidenceRecord;
  attachChart?: boolean;
  onSavingChange?: (saving: boolean) => void;
  onSaved: (record: EvidenceRecord) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<EvidenceCreate>(() => ({
    id: crypto.randomUUID(),
    title: original?.title ?? "",
    kind: original?.kind ?? (attachChart ? "image" : "report"),
    representation: original?.representation ?? (attachChart ? "chart_screenshot" : "original"),
    availability: original?.availability ?? "available",
    rights: original?.rights ?? "unknown",
    source_url: original?.source_url ?? null,
    author: original?.author ?? "",
    publisher: original?.publisher ?? "",
    published_date: original?.published_date ?? null,
    retrieved_at: original?.retrieved_at ?? null,
    as_of_date: original?.as_of_date ?? null,
    location: original?.location ?? { section: "", excerpt: "" },
    rights_note: original?.rights_note ?? "",
    notes: original?.notes ?? "",
    parent_id: original?.parent_id ?? null,
    replaces_id: original?.id ?? null,
    method: original?.method ?? "",
    units: original?.units ?? "",
    uncertainty: original?.uncertainty ?? "",
    table_format: original?.table_format ?? null,
    artifact_id: original?.artifact?.id ?? null,
    text: "",
  }));
  const [mode, setMode] = useState<"file" | "text" | "link" | "retained">(
    original?.artifact ? "retained" : original ? "link" : "file",
  );
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function update<K extends keyof EvidenceCreate>(key: K, value: EvidenceCreate[K]) {
    setDraft((current) => ({ ...current, id: crypto.randomUUID(), [key]: value }));
    setError("");
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    onSavingChange?.(true);
    setError("");
    try {
      if (mode === "file" && !file) throw new Error("Choose an original file.");
      const artifact =
        mode === "file" && file ? await uploadOriginal(file, draft.rights ?? "unknown") : null;
      const record = await api<EvidenceRecord>("evidence", {
        ...draft,
        artifact_id: mode === "retained" ? draft.artifact_id : (artifact?.id ?? null),
        text: mode === "text" ? draft.text : "",
        availability: mode === "link" ? draft.availability : "available",
      });
      onSaved(record);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save evidence.");
    } finally {
      setBusy(false);
      onSavingChange?.(false);
    }
  }
  const derived = ["ocr_interpretation", "digitized_estimate"].includes(
    draft.representation ?? "original",
  );
  const numeric = ["numeric_data", "digitized_estimate"].includes(
    draft.representation ?? "original",
  );
  return (
    <section className="evidence-form" aria-label="Source form">
      <div className="section-heading">
        <div>
          {!attachChart && <p className="eyebrow">Evidence desk</p>}
          <h2>
            {attachChart
              ? "Attach a chart"
              : original
                ? "Create a corrected version"
                : "Add a source"}
          </h2>
        </div>
      </div>
      <p className="muted">
        {attachChart
          ? "Upload a PNG, JPEG or WebP chart. Saving adds it to Sources and selects it for this run."
          : "Capture material you may use, or record a source link. Links are saved without fetching the website."}
      </p>
      {original && (
        <p className="field-hint">
          The earlier record and runs that use it will keep their original provenance.
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy}>
          <label htmlFor="source-title">Source title</label>
          <input
            id="source-title"
            required
            maxLength={240}
            value={draft.title}
            onChange={(event) => update("title", event.target.value)}
          />
          <div className="evidence-form-grid">
            <div>
              <label htmlFor="source-mode">Capture</label>
              <select
                id="source-mode"
                value={mode}
                onChange={(event) => {
                  const next = event.target.value as typeof mode;
                  setMode(next);
                  update("availability", next === "link" ? "reference_only" : "available");
                }}
              >
                {original?.artifact && <option value="retained">Keep captured original</option>}
                <option value="file">Upload a file</option>
                <option value="text">Paste text or data</option>
                <option value="link">Record a link</option>
              </select>
            </div>
            <div>
              <label htmlFor="source-kind">Source kind</label>
              <select
                id="source-kind"
                value={draft.kind}
                onChange={(event) => update("kind", event.target.value as EvidenceCreate["kind"])}
              >
                <option value="report">Report</option>
                <option value="discussion">X / discussion</option>
                <option value="image">Image</option>
                <option value="dataset">Dataset</option>
                <option value="text">Text</option>
                <option value="link">Link</option>
              </select>
            </div>
          </div>
          {mode === "file" && (
            <>
              <label htmlFor="source-file">Original file · up to 20 MB</label>
              <input
                id="source-file"
                type="file"
                accept={
                  draft.representation === "chart_screenshot"
                    ? "image/png,image/jpeg,image/webp"
                    : undefined
                }
                required
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null;
                  setFile(next);
                  if (
                    attachChart &&
                    next &&
                    (!draft.title || draft.title === file?.name.slice(0, 240))
                  ) {
                    update("title", next.name.slice(0, 240));
                  }
                  update("table_format", next?.name.toLowerCase().endsWith(".tsv") ? "tsv" : "csv");
                }}
              />
            </>
          )}
          {mode === "text" && (
            <>
              <label htmlFor="source-text">Source text or CSV/TSV</label>
              <textarea
                id="source-text"
                required
                rows={7}
                maxLength={200000}
                value={draft.text ?? ""}
                onChange={(event) => update("text", event.target.value)}
              />
            </>
          )}
          <label htmlFor="source-url">Original URL{mode !== "link" && " (optional)"}</label>
          <input
            id="source-url"
            type="url"
            required={mode === "link"}
            maxLength={2000}
            value={draft.source_url ?? ""}
            onChange={(event) => update("source_url", event.target.value || null)}
            placeholder="https://…"
          />
          {mode === "link" && (
            <>
              <label htmlFor="source-availability">Access status</label>
              <select
                id="source-availability"
                value={draft.availability}
                onChange={(event) =>
                  update("availability", event.target.value as EvidenceCreate["availability"])
                }
              >
                <option value="reference_only">Link only</option>
                <option value="missing">Missing</option>
                <option value="paywalled">Paywalled</option>
              </select>
            </>
          )}
          <div className="evidence-form-grid">
            <div>
              <label htmlFor="source-representation">Representation</label>
              <select
                id="source-representation"
                value={draft.representation}
                onChange={(event) =>
                  update("representation", event.target.value as EvidenceCreate["representation"])
                }
              >
                {Object.entries(representationLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="source-rights">Access rights</label>
              <select
                id="source-rights"
                value={draft.rights}
                onChange={(event) =>
                  update("rights", event.target.value as EvidenceCreate["rights"])
                }
              >
                {Object.entries(rightsLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {mode !== "link" && (
            <p className="field-hint">
              Captured content requires ownership, public-domain status, an open license, or
              permission.
            </p>
          )}
          <label htmlFor="source-parent">
            Derived from{derived ? " (required)" : " (optional)"}
          </label>
          <select
            id="source-parent"
            required={derived}
            value={draft.parent_id ?? ""}
            onChange={(event) => update("parent_id", event.target.value || null)}
          >
            <option value="">No parent source</option>
            {sources.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} · {item.id.slice(0, 8)}
              </option>
            ))}
          </select>
          {(derived || numeric) && (
            <div className="derivation-fields">
              <p className="field-hint">
                Record how these supplied values or interpretations were produced. Saving a source
                does not run OCR or digitization.
              </p>
              <label htmlFor="source-method">Source / derivation method</label>
              <textarea
                id="source-method"
                required
                rows={3}
                maxLength={4000}
                value={draft.method ?? ""}
                onChange={(event) => update("method", event.target.value)}
              />
              {numeric && (
                <div className="evidence-form-grid">
                  <div>
                    <label htmlFor="source-format">Data format</label>
                    <select
                      id="source-format"
                      required
                      value={draft.table_format ?? ""}
                      onChange={(event) =>
                        update("table_format", event.target.value as "csv" | "tsv")
                      }
                    >
                      <option value="">Choose format</option>
                      <option value="csv">CSV</option>
                      <option value="tsv">TSV</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="source-units">Units</label>
                    <input
                      id="source-units"
                      required
                      maxLength={1000}
                      value={draft.units ?? ""}
                      onChange={(event) => update("units", event.target.value)}
                      placeholder="e.g. USD, percent"
                    />
                  </div>
                </div>
              )}
              {draft.representation === "digitized_estimate" && (
                <>
                  <label htmlFor="source-uncertainty">Uncertainty</label>
                  <textarea
                    id="source-uncertainty"
                    required
                    rows={2}
                    maxLength={2000}
                    value={draft.uncertainty ?? ""}
                    onChange={(event) => update("uncertainty", event.target.value)}
                    placeholder="Describe resolution, rounding, and likely error."
                  />
                </>
              )}
            </div>
          )}
          <details className="source-metadata" open={Boolean(original)}>
            <summary>Provenance, dates &amp; location</summary>
            <div className="evidence-form-grid">
              <div>
                <label htmlFor="source-author">Author</label>
                <input
                  id="source-author"
                  maxLength={240}
                  value={draft.author ?? ""}
                  onChange={(event) => update("author", event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="source-publisher">Publisher</label>
                <input
                  id="source-publisher"
                  maxLength={240}
                  value={draft.publisher ?? ""}
                  onChange={(event) => update("publisher", event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="source-published">Published date</label>
                <input
                  id="source-published"
                  type="date"
                  value={draft.published_date ?? ""}
                  onChange={(event) => update("published_date", event.target.value || null)}
                />
              </div>
              <div>
                <label htmlFor="source-asof">As-of date</label>
                <input
                  id="source-asof"
                  type="date"
                  value={draft.as_of_date ?? ""}
                  onChange={(event) => update("as_of_date", event.target.value || null)}
                />
              </div>
            </div>
            <label htmlFor="source-retrieved">Retrieved at (with timezone)</label>
            <input
              id="source-retrieved"
              value={draft.retrieved_at ?? ""}
              onChange={(event) => update("retrieved_at", event.target.value || null)}
              placeholder="2026-01-15T14:30:00Z"
            />
            <div className="evidence-form-grid">
              <div>
                <label htmlFor="source-page">First page</label>
                <input
                  id="source-page"
                  type="number"
                  min={1}
                  max={1000000}
                  value={draft.location?.page_start ?? ""}
                  onChange={(event) =>
                    update("location", {
                      ...(draft.location ?? { section: "", excerpt: "" }),
                      page_start: event.target.value ? Number(event.target.value) : null,
                    })
                  }
                />
              </div>
              <div>
                <label htmlFor="source-page-end">Last page</label>
                <input
                  id="source-page-end"
                  type="number"
                  min={1}
                  max={1000000}
                  value={draft.location?.page_end ?? ""}
                  onChange={(event) =>
                    update("location", {
                      ...(draft.location ?? { section: "", excerpt: "" }),
                      page_end: event.target.value ? Number(event.target.value) : null,
                    })
                  }
                />
              </div>
            </div>
            <label htmlFor="source-section">Section / post location</label>
            <input
              id="source-section"
              maxLength={500}
              value={draft.location?.section ?? ""}
              onChange={(event) =>
                update("location", {
                  ...(draft.location ?? { section: "", excerpt: "" }),
                  section: event.target.value,
                })
              }
            />
            <label htmlFor="source-excerpt">Excerpt</label>
            <textarea
              id="source-excerpt"
              rows={3}
              maxLength={6000}
              value={draft.location?.excerpt ?? ""}
              onChange={(event) =>
                update("location", {
                  ...(draft.location ?? { section: "", excerpt: "" }),
                  excerpt: event.target.value,
                })
              }
            />
            <label htmlFor="source-rights-note">Rights / license note</label>
            <input
              id="source-rights-note"
              maxLength={2000}
              value={draft.rights_note ?? ""}
              onChange={(event) => update("rights_note", event.target.value)}
            />
            <label htmlFor="source-notes">Notes</label>
            <textarea
              id="source-notes"
              rows={3}
              maxLength={6000}
              value={draft.notes ?? ""}
              onChange={(event) => update("notes", event.target.value)}
            />
          </details>
        </fieldset>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          <Button className="button" disabled={busy} onClick={onCancel}>
            Cancel source
          </Button>
          <Button className="button primary" type="submit" disabled={busy}>
            {busy
              ? "Saving source…"
              : attachChart
                ? "Save and attach"
                : original
                  ? "Save corrected version"
                  : "Save source"}
          </Button>
        </div>
      </form>
    </section>
  );
}
