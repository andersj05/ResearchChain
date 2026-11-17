"use client";

import { useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { api } from "@/lib/workflow";
import {
  availabilityLabels,
  type ClaimCreate,
  type ClaimLink,
  type ClaimRecord,
  type EvidenceRecord,
} from "@/lib/evidence";

export function ClaimForm({
  sources,
  original,
  selected,
  onSaved,
  onCancel,
}: {
  sources: EvidenceRecord[];
  original?: ClaimRecord;
  selected?: string;
  onSaved: (claim: ClaimRecord) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ClaimCreate>(() => ({
    id: crypto.randomUUID(),
    text: original?.text ?? "",
    kind: original?.kind ?? "hypothesis",
    as_of_date: original?.as_of_date ?? null,
    replaces_id: original?.id ?? null,
    links:
      original?.links ??
      (selected ? [{ evidence_id: selected, relation: "context", rationale: "" }] : []),
  }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function update(patch: Partial<ClaimCreate>) {
    setDraft((current) => ({ ...current, ...patch, id: crypto.randomUUID() }));
    setError("");
  }
  function linkAt(index: number, patch: Partial<ClaimLink>) {
    update({
      links: draft.links?.map((link, offset) => (offset === index ? { ...link, ...patch } : link)),
    });
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onSaved(await api<ClaimRecord>("claims", draft));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save claim.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="evidence-form" aria-label="Claim form">
      <h2>{original ? "Revise a claim" : "Add a claim"}</h2>
      <p className="muted">
        Link the evidence that supports, contradicts, or gives context to this statement.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy}>
          <label htmlFor="claim-text">Claim statement</label>
          <textarea
            id="claim-text"
            required
            rows={4}
            maxLength={6000}
            value={draft.text}
            onChange={(event) => update({ text: event.target.value })}
          />
          <div className="evidence-form-grid">
            <div>
              <label htmlFor="claim-kind">Statement kind</label>
              <select
                id="claim-kind"
                value={draft.kind}
                onChange={(event) => update({ kind: event.target.value as ClaimCreate["kind"] })}
              >
                <option value="hypothesis">Hypothesis</option>
                <option value="observation">Observation</option>
                <option value="interpretation">Interpretation</option>
              </select>
            </div>
            <div>
              <label htmlFor="claim-asof">Claim as-of date</label>
              <input
                id="claim-asof"
                type="date"
                value={draft.as_of_date ?? ""}
                onChange={(event) => update({ as_of_date: event.target.value || null })}
              />
            </div>
          </div>
          <div className="section-heading claim-links-heading">
            <h3>Evidence relationships</h3>
            <Button
              className="button small"
              disabled={!sources.length || (draft.links?.length ?? 0) >= 100}
              onClick={() =>
                update({
                  links: [
                    ...(draft.links ?? []),
                    { evidence_id: sources[0]!.id, relation: "supports", rationale: "" },
                  ],
                })
              }
            >
              Add evidence link
            </Button>
          </div>
          {draft.links?.map((link, index) => (
            <div className="claim-link-form" key={index}>
              <label htmlFor={`claim-source-${index}`}>Evidence source {index + 1}</label>
              <select
                id={`claim-source-${index}`}
                value={link.evidence_id}
                onChange={(event) => linkAt(index, { evidence_id: event.target.value })}
              >
                {!sources.some((source) => source.id === link.evidence_id) && (
                  <option value={link.evidence_id}>{link.evidence_id}</option>
                )}
                {sources.map((source) => (
                  <option value={source.id} key={source.id}>
                    {source.title} · {availabilityLabels[source.availability ?? "available"]}
                  </option>
                ))}
              </select>
              <label htmlFor={`claim-relation-${index}`}>Relationship {index + 1}</label>
              <select
                id={`claim-relation-${index}`}
                value={link.relation}
                onChange={(event) =>
                  linkAt(index, { relation: event.target.value as ClaimLink["relation"] })
                }
              >
                <option value="supports">Supports</option>
                <option value="contradicts">Contradicts</option>
                <option value="context">Context</option>
              </select>
              <label htmlFor={`claim-rationale-${index}`}>Rationale {index + 1}</label>
              <textarea
                id={`claim-rationale-${index}`}
                rows={2}
                maxLength={3000}
                value={link.rationale ?? ""}
                onChange={(event) => linkAt(index, { rationale: event.target.value })}
              />
              <details>
                <summary>Page &amp; excerpt</summary>
                <label htmlFor={`claim-page-${index}`}>Evidence page {index + 1}</label>
                <input
                  id={`claim-page-${index}`}
                  type="number"
                  min={1}
                  max={1000000}
                  value={link.location?.page_start ?? ""}
                  onChange={(event) =>
                    linkAt(index, {
                      location: {
                        ...(link.location ?? { section: "", excerpt: "" }),
                        page_start: event.target.value ? Number(event.target.value) : null,
                      },
                    })
                  }
                />
                <label htmlFor={`claim-excerpt-${index}`}>Evidence excerpt {index + 1}</label>
                <textarea
                  id={`claim-excerpt-${index}`}
                  maxLength={6000}
                  rows={2}
                  value={link.location?.excerpt ?? ""}
                  onChange={(event) =>
                    linkAt(index, {
                      location: {
                        ...(link.location ?? { section: "", excerpt: "" }),
                        excerpt: event.target.value,
                      },
                    })
                  }
                />
              </details>
              <Button
                className="button small"
                onClick={() =>
                  update({ links: draft.links?.filter((_, offset) => offset !== index) })
                }
              >
                Remove link {index + 1}
              </Button>
            </div>
          ))}
          {!draft.links?.length && (
            <p className="field-hint">This claim has no linked evidence yet.</p>
          )}
        </fieldset>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          <Button className="button" disabled={busy} onClick={onCancel}>
            Cancel claim
          </Button>
          <Button className="button primary" type="submit" disabled={busy}>
            {busy ? "Saving claim…" : original ? "Save revised claim" : "Save claim"}
          </Button>
        </div>
      </form>
    </section>
  );
}
