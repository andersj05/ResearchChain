"use client";
/* eslint-disable @next/next/no-img-element -- Display captured chart originals without transforms. */

import { useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { contentUrl, evidenceUrl, representationLabels, type EvidenceRecord } from "@/lib/evidence";
import type { ReportSection, ReportView } from "@/lib/reports";

type Citation = NonNullable<ReportSection["citations"]>[number];
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
  view,
  disabled,
  onChange,
}: {
  section: ReportSection;
  view: ReportView;
  disabled: boolean;
  onChange: (section: ReportSection) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [citation, setCitation] = useState<Citation | null>(null);
  const [error, setError] = useState("");
  const sources = view.revision.sources;
  const charts = sources.filter(
    (s) => s.artifact && ["image/png", "image/jpeg", "image/webp"].includes(s.artifact.media_type),
  );
  const currentSource = sources.find((s) => s.id === citation?.evidence_id);
  function choose(id: string) {
    const basis = view.source_bases[id] as Citation["basis"];
    setCitation({
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
              onClick={() => {
                setEditing(i);
                setCitation(c);
                setError("");
              }}
            >
              Edit reference {i + 1}
            </Button>
            <Button
              className="button small"
              disabled={disabled}
              onClick={() => {
                onChange({ ...section, citations: section.citations?.filter((_, n) => n !== i) });
                setCitation(null);
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
          disabled={disabled || !sources.length}
          onClick={() => {
            setEditing(null);
            choose(sources[0]!.id);
            setError("");
          }}
        >
          Add source reference
        </Button>
      ) : (
        <fieldset disabled={disabled} className="report-citation-form">
          <legend>{editing === null ? "New reference" : "Edit reference"}</legend>
          <label>
            Reference source
            <select value={citation.evidence_id} onChange={(e) => choose(e.target.value)}>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <p className="field-hint">Basis: {citation.basis.replaceAll("_", " ")}</p>
          <label>
            Evidence relationship
            <select
              disabled={citation.basis === "metadata_only"}
              value={citation.relation}
              onChange={(e) =>
                setCitation({ ...citation, relation: e.target.value as Citation["relation"] })
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
              onChange={(e) => setCitation({ ...citation, locator: e.target.value })}
              placeholder="Page, section, row, or chart detail"
            />
          </label>
          {currentSource?.artifact?.media_type.startsWith("text/") && (
            <label>
              Exact quotation (optional)
              <textarea
                maxLength={2000}
                rows={3}
                value={citation.quote}
                onChange={(e) => setCitation({ ...citation, quote: e.target.value })}
              />
            </label>
          )}
          <label>
            Why this source matters
            <textarea
              maxLength={3000}
              rows={2}
              value={citation.rationale}
              onChange={(e) => setCitation({ ...citation, rationale: e.target.value })}
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
              onClick={() => {
                if (!citation.locator.trim() || !citation.rationale.trim()) {
                  setError("Add a location and explain why this source matters.");
                  return;
                }
                onChange({
                  ...section,
                  citations:
                    editing === null
                      ? [...(section.citations ?? []), citation]
                      : (section.citations ?? []).map((c, i) => (i === editing ? citation : c)),
                });
                setCitation(null);
                setError("");
              }}
            >
              Apply reference to draft
            </Button>
            <Button className="button" onClick={() => setCitation(null)}>
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
              checked={section.chart_ids?.includes(source.id) ?? false}
              onChange={(e) =>
                onChange({
                  ...section,
                  chart_ids: e.target.checked
                    ? [...(section.chart_ids ?? []), source.id]
                    : section.chart_ids?.filter((id) => id !== source.id),
                })
              }
            />
            {source.title}
          </label>
        ))}
      </fieldset>
      {(section.chart_ids ?? []).map((id) => {
        const source = charts.find((s) => s.id === id);
        return source?.artifact ? (
          <figure className="report-chart" key={id}>
            <img src={contentUrl(source.artifact.id) + "?preview=true"} alt={source.title} />
            <figcaption>
              {source.title} · {source.representation} · As of {source.as_of_date ?? "unknown"}
            </figcaption>
          </figure>
        ) : null;
      })}
    </div>
  );
}
