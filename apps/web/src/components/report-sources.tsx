"use client";
/* eslint-disable @next/next/no-img-element -- Display captured chart originals without transforms. */

import { Button } from "@ui-sdk/react/button";
import { contentUrl, evidenceUrl, representationLabels, type EvidenceRecord } from "@/lib/evidence";
import type { ReportSection, ReportView } from "@/lib/reports";

type Citation = NonNullable<ReportSection["citations"]>[number];

export type SectionReferenceDraft = {
  citation: Citation;
  editing: number | null;
  error?: string;
};

export function ReportSource({ source }: { source: EvidenceRecord }) {
  return (
    <details className="report-source">
      <summary>{source.title}</summary>
      <p>
        {representationLabels[source.representation ?? "original"]} · {source.availability} · As of{" "}
        {source.as_of_date ?? "unknown"}
      </p>
      <p>
        {source.author} {source.publisher} · Published {source.published_date ?? "unknown"}
      </p>
      {source.uncertainty && <p>Uncertainty: {source.uncertainty}</p>}
      {source.method && <p>Method: {source.method}</p>}
      {source.preview?.text && (
        <pre className="report-source-text">{source.preview.text.slice(0, 3000)}</pre>
      )}
      {(source.preview?.text?.length ?? 0) > 3000 && (
        <p className="field-hint">Excerpt shown. Open the source for more.</p>
      )}
      {!!source.preview?.columns?.length && (
        <div className="report-table">
          <table>
            <thead>
              <tr>
                {(source.preview?.columns ?? []).map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(source.preview?.rows ?? []).map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            {source.preview?.row_count} rows in original · Units: {source.units || "not supplied"}
          </p>
        </div>
      )}
      <div className="actions">
        <a href={evidenceUrl(source.id)} target="_blank" rel="noopener noreferrer">
          Inspect source
        </a>
        {source.artifact && (
          <a href={contentUrl(source.artifact.id)} download>
            Download original
          </a>
        )}
      </div>
      <p className="code-label">{source.content_hash ?? "No captured original"}</p>
    </details>
  );
}
export function ReportSectionSources({
  section,
  sources,
  sourceBases,
  disabled,
  onChange,
  referenceDraft,
  onReferenceDraftChange,
}: {
  section: ReportSection;
  sources: EvidenceRecord[];
  sourceBases: ReportView["source_bases"];
  disabled: boolean;
  onChange: (section: ReportSection) => void;
  referenceDraft?: SectionReferenceDraft;
  onReferenceDraftChange: (draft: SectionReferenceDraft | null) => void;
}) {
  const citation = referenceDraft?.citation;
  const editing = referenceDraft?.editing ?? null;
  const error = referenceDraft?.error;
  const referenceSources = sources.filter((source) => sourceBases[source.id]);
  const charts = sources.filter(
    (s) => s.artifact && ["image/png", "image/jpeg", "image/webp"].includes(s.artifact.media_type),
  );
  const placedCharts = section.chart_ids ?? [];
  const currentSource = referenceSources.find((s) => s.id === citation?.evidence_id);
  function changeCitation(citation: Citation) {
    onReferenceDraftChange({ citation, editing, error });
  }
  function choose(id: string) {
    const basis = sourceBases[id] as Citation["basis"] | undefined;
    if (!basis) return;
    changeCitation({
      evidence_id: id,
      basis,
      relation: basis === "metadata_only" ? "context" : "supports",
      locator: "",
      quote: "",
      rationale: "",
    });
  }
  return (
    <div className="report-section-sources">
      <h3>References for this section</h3>
      <p className="field-hint">
        Citations point to captured sources. Exact quotations are checked when you save; their
        meaning and support still need review.
      </p>
      {(section.citations ?? []).map((c, i) => (
        <article className="report-citation" key={i}>
          <strong>{sources.find((s) => s.id === c.evidence_id)?.title ?? c.evidence_id}</strong>
          <p>
            {c.relation} · {c.basis.replaceAll("_", " ")} · {c.locator}
          </p>
          {c.quote && <blockquote>{c.quote}</blockquote>}
          <p>{c.rationale}</p>
          <div className="actions">
            <Button
              className="button small"
              disabled={disabled}
              onClick={() => onReferenceDraftChange({ editing: i, citation: c })}
            >
              Edit reference {i + 1}
            </Button>
            <Button
              className="button small"
              disabled={disabled}
              onClick={() => {
                onChange({ ...section, citations: section.citations?.filter((_, n) => n !== i) });
                onReferenceDraftChange(null);
              }}
            >
              Remove reference {i + 1}
            </Button>
          </div>
        </article>
      ))}
      {!citation ? (
        <Button
          className="button small"
          disabled={disabled || !referenceSources.length}
          onClick={() => choose(referenceSources[0]!.id)}
        >
          Add source reference
        </Button>
      ) : (
        <fieldset disabled={disabled} className="report-citation-form">
          <legend>{editing === null ? "New reference" : "Edit reference"}</legend>
          <label>
            Reference source
            <select value={citation.evidence_id} onChange={(e) => choose(e.target.value)}>
              {!currentSource && (
                <option value={citation.evidence_id} disabled>
                  Selected source unavailable
                </option>
              )}
              {referenceSources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <p className="field-hint">Basis: {citation.basis.replaceAll("_", " ")}</p>
          {!currentSource && (
            <p className="field-hint">
              Choose another source or retry draft source details in Report context.
            </p>
          )}
          {currentSource && (
            <a
              className="button small"
              href={evidenceUrl(currentSource.id)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Inspect selected source (new tab)
            </a>
          )}
          <label>
            Evidence relationship
            <select
              disabled={citation.basis === "metadata_only"}
              value={citation.relation}
              onChange={(e) =>
                changeCitation({ ...citation, relation: e.target.value as Citation["relation"] })
              }
            >
              <option value="supports">Supports</option>
              <option value="contradicts">Contradicts</option>
              <option value="context">Context</option>
            </select>
          </label>
          <label>
            Source location
            <input
              maxLength={500}
              value={citation.locator}
              onChange={(e) => changeCitation({ ...citation, locator: e.target.value })}
              placeholder="Page, section, row, or chart detail"
            />
          </label>
          {citation.basis !== "metadata_only" &&
            currentSource?.artifact?.media_type.startsWith("text/") && (
              <label>
                Exact quotation (optional)
                <textarea
                  maxLength={2000}
                  rows={3}
                  value={citation.quote}
                  onChange={(e) => changeCitation({ ...citation, quote: e.target.value })}
                />
              </label>
            )}
          <label>
            Why this source matters
            <textarea
              maxLength={3000}
              rows={2}
              value={citation.rationale}
              onChange={(e) => changeCitation({ ...citation, rationale: e.target.value })}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            <Button
              className="button"
              disabled={!currentSource}
              onClick={() => {
                if (!citation.locator.trim() || !citation.rationale.trim()) {
                  onReferenceDraftChange({
                    citation,
                    editing,
                    error: "Add a location and explain why this source matters.",
                  });
                  return;
                }
                onChange({
                  ...section,
                  citations:
                    editing === null
                      ? [...(section.citations ?? []), citation]
                      : (section.citations ?? []).map((c, i) => (i === editing ? citation : c)),
                });
                onReferenceDraftChange(null);
              }}
            >
              Apply reference to draft
            </Button>
            <Button className="button" onClick={() => onReferenceDraftChange(null)}>
              Cancel reference
            </Button>
          </div>
        </fieldset>
      )}
      <h3>Chart originals</h3>
      {!charts.length && (
        <p className="muted">
          Add a captured PNG, JPEG, or WebP source to the report to place a chart here.
        </p>
      )}
      <fieldset disabled={disabled}>
        {charts.map((source) => (
          <label className="report-check" key={source.id}>
            <input
              type="checkbox"
              checked={placedCharts.includes(source.id)}
              onChange={(e) =>
                onChange({
                  ...section,
                  chart_ids: e.target.checked
                    ? [...placedCharts, source.id]
                    : placedCharts.filter((id) => id !== source.id),
                })
              }
            />
            {source.title}
          </label>
        ))}
      </fieldset>
      {placedCharts.map((id) => {
        const source = charts.find((s) => s.id === id);
        return source?.artifact ? (
          <figure className="report-chart" key={id}>
            <img src={contentUrl(source.artifact.id) + "?preview=true"} alt={source.title} />
            <figcaption>
              {source.title} · {source.representation} · As of {source.as_of_date ?? "unknown"}
            </figcaption>
          </figure>
        ) : (
          <div className="actions" key={id}>
            <p className="field-hint">Chart {id.slice(0, 8)} preview unavailable.</p>
            <Button
              className="button small"
              disabled={disabled}
              aria-label={`Remove unavailable chart ${id.slice(0, 8)}`}
              onClick={() =>
                onChange({ ...section, chart_ids: placedCharts.filter((key) => key !== id) })
              }
            >
              Remove chart
            </Button>
          </div>
        );
      })}
    </div>
  );
}
