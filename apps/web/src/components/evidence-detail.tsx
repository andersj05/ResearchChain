"use client";

/* eslint-disable @next/next/no-img-element -- Show immutable originals without image transforms. */

import { Button } from "@ui-sdk/react/button";
import {
  availabilityLabels,
  contentUrl,
  evidenceUrl,
  representationLabels,
  rightsLabels,
  type EvidenceRecord,
} from "@/lib/evidence";

export function EvidenceDetail({
  record,
  onCorrect,
}: {
  record: EvidenceRecord;
  onCorrect: () => void;
}) {
  const preview = record.preview;
  const artifact = record.artifact;
  const image = artifact && ["image/png", "image/jpeg", "image/webp"].includes(artifact.media_type);
  const location = record.location;
  return (
    <article className="evidence-detail" aria-label="Source inspection">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{representationLabels[record.representation ?? "original"]}</p>
          <h2>{record.title}</h2>
        </div>
        <Button className="button small" onClick={onCorrect}>
          Correct provenance
        </Button>
      </div>
      <div className="source-badges">
        <span className={`source-status source-${record.availability}`}>
          {availabilityLabels[record.availability ?? "available"]}
        </span>
        <span>{record.kind}</span>
        <span>Source content · untrusted</span>
      </div>
      <div className="actions source-links">
        {artifact && (
          <a className="button" href={contentUrl(artifact.id)} download>
            Download original
          </a>
        )}
        {record.source_url && (
          <a className="button" href={record.source_url} target="_blank" rel="noopener noreferrer">
            Open source URL
          </a>
        )}
      </div>
      {!artifact && (
        <p className="source-notice">
          No original was captured. This record has no content hash or verified excerpt beyond the
          metadata you supplied.
        </p>
      )}
      {record.representation === "digitized_estimate" && (
        <p className="source-notice">
          These values are estimates derived from a chart. Uncertainty: {record.uncertainty}
        </p>
      )}
      {record.representation === "ocr_interpretation" && (
        <p className="source-notice">
          Supplied text interpretation. Check it against the parent original before using it as
          evidence.
        </p>
      )}
      <dl className="provenance-grid">
        <dt>Author / publisher</dt>
        <dd>{[record.author, record.publisher].filter(Boolean).join(" / ") || "Unknown"}</dd>
        <dt>Published / as of</dt>
        <dd>
          {record.published_date ?? "Unknown"} / {record.as_of_date ?? "Unknown"}
        </dd>
        <dt>Retrieved at</dt>
        <dd>{record.retrieved_at ?? "Not supplied"}</dd>
        <dt>Original stored at</dt>
        <dd>{record.captured_at ?? "Not captured"}</dd>
        <dt>Access rights</dt>
        <dd>
          {rightsLabels[record.rights ?? "unknown"]}
          {record.rights_note && ` · ${record.rights_note}`}
        </dd>
        <dt>Location</dt>
        <dd>
          {location?.page_start
            ? `Page ${location.page_start}${location.page_end ? `–${location.page_end}` : ""}`
            : "No page supplied"}
          {location?.section && ` · ${location.section}`}
        </dd>
        {artifact && (
          <>
            <dt>Original file</dt>
            <dd>
              {artifact.name} · {artifact.byte_size.toLocaleString()} bytes · {artifact.media_type}
            </dd>
            <dt>Content hash</dt>
            <dd className="code-label">{record.content_hash}</dd>
          </>
        )}
        {record.parent_id && (
          <>
            <dt>Derived from</dt>
            <dd>
              <a href={evidenceUrl(record.parent_id)}>
                Inspect parent source · {record.parent_id.slice(0, 8)}
              </a>
            </dd>
          </>
        )}
        {record.replaces_id && (
          <>
            <dt>Previous version</dt>
            <dd>
              <a href={evidenceUrl(record.replaces_id)}>
                Inspect previous version · {record.replaces_id.slice(0, 8)}
              </a>
            </dd>
          </>
        )}
        {record.method && (
          <>
            <dt>Method</dt>
            <dd>{record.method}</dd>
          </>
        )}
        {record.units && (
          <>
            <dt>Units</dt>
            <dd>{record.units}</dd>
          </>
        )}
      </dl>
      {location?.excerpt && (
        <section className="source-excerpt">
          <h3>Located excerpt</h3>
          <blockquote>{location.excerpt}</blockquote>
        </section>
      )}
      {record.notes && (
        <section className="source-excerpt">
          <h3>Notes</h3>
          <p>{record.notes}</p>
        </section>
      )}
      {artifact && (
        <section className="original-preview" aria-label="Original preview">
          <h3>Captured original</h3>
          {image && (
            /* The local immutable original is deliberately shown without image transforms. */ <img
              src={`${contentUrl(artifact.id)}?preview=true`}
              alt={record.title}
              className="source-image"
            />
          )}
          {preview?.text && <pre>{preview.text}</pre>}
          {Boolean(preview?.columns?.length) && (
            <>
              <p className="field-hint">
                {preview?.row_count?.toLocaleString()} rows · Numeric columns:{" "}
                {preview?.numeric_columns?.join(", ")} · {record.table_format?.toUpperCase()} /{" "}
                {preview?.parser_version}
              </p>
              <div className="source-table-wrap">
                <table>
                  <thead>
                    <tr>
                      {preview?.columns?.map((column) => (
                        <th key={column}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview?.rows?.map((row, index) => (
                      <tr key={index}>
                        {row.map((value, cell) => (
                          <td key={cell}>{value}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {preview?.truncated && (
            <p className="field-hint">
              Preview shortened. Download the original for all content and exact values.
            </p>
          )}
          {!image && !preview?.text && !preview?.columns?.length && (
            <p className="muted">Download the original to inspect this file.</p>
          )}
        </section>
      )}
    </article>
  );
}
