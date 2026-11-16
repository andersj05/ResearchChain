"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { api } from "@/lib/workflow";
import {
  availabilityLabels,
  evidenceUrl,
  representationLabels,
  type ClaimPage,
  type ClaimRecord,
  type EvidencePage,
  type EvidenceRecord,
} from "@/lib/evidence";
import { CollectionLayout } from "@/components/collection-layout";
import { EvidenceForm } from "@/components/evidence-form";
import { EvidenceDetail } from "@/components/evidence-detail";
import { ClaimForm } from "@/components/claim-form";

export function EvidenceDesk() {
  const desk = useRef<HTMLElement>(null);
  const [sources, setSources] = useState<EvidenceRecord[]>([]);
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [selected, setSelected] = useState<EvidenceRecord | null>(null);
  const [nextSource, setNextSource] = useState<number | null>(null);
  const [nextClaim, setNextClaim] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [form, setForm] = useState<"source" | "claim" | null>(null);
  const [correcting, setCorrecting] = useState<EvidenceRecord>();
  const [revising, setRevising] = useState<ClaimRecord>();
  const [search, setSearch] = useState("");
  const [availability, setAvailability] = useState("all");
  const [selectedClaims, setSelectedClaims] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadEpoch, setLoadEpoch] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [page, claimPage] = await Promise.all([
          api<EvidencePage>("evidence?limit=50"),
          api<ClaimPage>("claims?limit=50"),
        ]);
        const id = new URL(window.location.href).searchParams.get("evidence");
        const initial = id
          ? (page.items.find((item) => item.id === id) ??
            (await api<EvidenceRecord>(`evidence/${encodeURIComponent(id)}`)))
          : page.items[0];
        if (!active) return;
        setSources(
          initial && !page.items.some((item) => item.id === initial.id)
            ? [initial, ...page.items]
            : page.items,
        );
        setClaims(claimPage.items);
        setSelected(initial ?? null);
        setTotal(page.total);
        setNextSource(page.next_offset ?? null);
        setNextClaim(claimPage.next_offset ?? null);
        setError("");
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : "Unable to load the evidence desk.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [loadEpoch]);
  useEffect(() => {
    desk.current?.parentElement?.scrollTo({ top: 0 });
  }, [form, selected]);

  function select(record: EvidenceRecord) {
    setSelected(record);
    setForm(null);
    setMessage("");
    const url = new URL(window.location.href);
    url.searchParams.set("evidence", record.id);
    window.history.replaceState(null, "", url);
  }
  function sourceSaved(record: EvidenceRecord) {
    setSources((previous) => [record, ...previous.filter((item) => item.id !== record.id)]);
    setTotal((previous) => previous + (sources.some((item) => item.id === record.id) ? 0 : 1));
    if (nextSource !== null) setNextSource(nextSource + 1);
    select(record);
    setMessage("Source saved. Original content and provenance are preserved.");
  }
  async function more(kind: "evidence" | "claims") {
    setError("");
    try {
      if (kind === "evidence") {
        const page = await api<EvidencePage>(`evidence?limit=50&offset=${nextSource}`);
        setSources((previous) => [
          ...new Map([...previous, ...page.items].map((item) => [item.id, item])).values(),
        ]);
        setNextSource(page.next_offset ?? null);
        setTotal(page.total);
      } else {
        const page = await api<ClaimPage>(`claims?limit=50&offset=${nextClaim}`);
        setClaims((previous) => [
          ...new Map([...previous, ...page.items].map((item) => [item.id, item])).values(),
        ]);
        setNextClaim(page.next_offset ?? null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load more records.");
    }
  }
  const visible = sources.filter(
    (source) =>
      `${source.title} ${source.author ?? ""} ${source.publisher ?? ""}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (availability === "all" || (source.availability ?? "available") === availability),
  );
  const visibleClaims =
    selectedClaims && selected
      ? claims.filter((claim) => claim.links?.some((link) => link.evidence_id === selected.id))
      : claims;
  return (
    <section ref={desk} className="evidence-desk" aria-label="Evidence desk">
      <header className="evidence-header">
        <div>
          <p className="eyebrow">Research inputs</p>
          <h1>
            Sources <span className="count">{total}</span>
          </h1>
          <p className="muted">Original sources, their provenance, and the claims they inform.</p>
        </div>
        <div className="actions">
          <Button
            className="button"
            disabled={loading}
            onClick={() => {
              setRevising(undefined);
              setForm("claim");
            }}
          >
            Add claim
          </Button>
          <Button
            className="button primary"
            disabled={loading}
            onClick={() => {
              setCorrecting(undefined);
              setForm("source");
            }}
          >
            Add source
          </Button>
        </div>
      </header>
      {message && (
        <p className="evidence-message" role="status">
          {message}
        </p>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <Button
            className="button small"
            onClick={() => {
              setLoading(true);
              setLoadEpoch((value) => value + 1);
            }}
          >
            Reload evidence
          </Button>
        </div>
      )}
      {loading ? (
        <p className="muted evidence-loading" role="status">
          Loading sources…
        </p>
      ) : (
        <CollectionLayout
          id="sources"
          list={
            <aside className="source-list" aria-label="Sources">
              <label htmlFor="source-search">Find a loaded source</label>
              <input
                id="source-search"
                type="search"
                placeholder="Title, author, publisher…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <label htmlFor="source-availability-filter">Availability</label>
              <select
                id="source-availability-filter"
                value={availability}
                onChange={(event) => setAvailability(event.target.value)}
              >
                <option value="all">All sources</option>
                {Object.entries(availabilityLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <p className="collection-count">
                {visible.length} shown · {sources.length} of {total} loaded
              </p>
              <div className="source-list-items">
                {visible.map((source) => (
                  <button
                    key={source.id}
                    className={`source-list-item ${selected?.id === source.id && !form ? "selected" : ""}`}
                    aria-pressed={selected?.id === source.id && !form}
                    onClick={() => select(source)}
                  >
                    <strong>{source.title}</strong>
                    <span>{source.publisher || source.author || "Publisher not recorded"}</span>
                    <span>
                      {representationLabels[source.representation ?? "original"]}
                      {source.as_of_date ? ` · As of ${source.as_of_date}` : ""}
                    </span>
                    <small className={`source-status source-${source.availability}`}>
                      {availabilityLabels[source.availability ?? "available"]}
                    </small>
                  </button>
                ))}
              </div>
              {!sources.length && (
                <p className="muted">
                  No sources yet. Add a permitted report, chart, dataset, discussion, or link.
                </p>
              )}
              {sources.length > 0 && !visible.length && (
                <p className="muted">No matching loaded sources.</p>
              )}
              {nextSource !== null && (
                <Button className="button small" onClick={() => more("evidence")}>
                  Load more sources
                </Button>
              )}
            </aside>
          }
          detail={
            <div className="evidence-main">
              {form === "source" ? (
                <EvidenceForm
                  key={correcting?.id ?? "new"}
                  sources={sources}
                  original={correcting}
                  onSaved={sourceSaved}
                  onCancel={() => setForm(null)}
                />
              ) : form === "claim" ? (
                <ClaimForm
                  key={revising?.id ?? "new"}
                  sources={sources}
                  original={revising}
                  selected={selected?.id}
                  onSaved={(claim) => {
                    setClaims((previous) => [
                      claim,
                      ...previous.filter((item) => item.id !== claim.id),
                    ]);
                    if (nextClaim !== null) setNextClaim(nextClaim + 1);
                    setForm(null);
                    setMessage("Claim saved with its evidence relationships.");
                  }}
                  onCancel={() => setForm(null)}
                />
              ) : selected ? (
                <EvidenceDetail
                  record={selected}
                  onCorrect={() => {
                    setCorrecting(selected);
                    setForm("source");
                  }}
                />
              ) : (
                <div className="empty-state">
                  <h2>Start your source library</h2>
                  <p>
                    Keep source material and claims connected, with uncertainty and missing
                    information visible.
                  </p>
                  <Button
                    className="button"
                    onClick={() => {
                      setCorrecting(undefined);
                      setForm("source");
                    }}
                  >
                    Capture your first source
                  </Button>
                </div>
              )}
              {!form && (
                <section className="claim-library" aria-label="Saved claims">
                  <div className="section-heading">
                    <h2>Claims</h2>
                    <span className="muted">{claims.length} loaded</span>
                  </div>
                  {selected && (
                    <label className="collection-checkbox">
                      <input
                        type="checkbox"
                        checked={selectedClaims}
                        onChange={(event) => setSelectedClaims(event.target.checked)}
                      />
                      Claims linked to this source
                    </label>
                  )}
                  {visibleClaims.length ? (
                    visibleClaims.map((claim) => (
                      <article className="claim-card" key={claim.id}>
                        <div className="section-heading">
                          <p className="eyebrow">
                            {claim.kind}
                            {claim.as_of_date && ` · As of ${claim.as_of_date}`}
                          </p>
                          <Button
                            className="button small"
                            onClick={() => {
                              setRevising(claim);
                              setForm("claim");
                            }}
                          >
                            Revise claim
                          </Button>
                        </div>
                        <p>{claim.text}</p>
                        {claim.replaces_id && (
                          <p className="field-hint">
                            Revises claim {claim.replaces_id.slice(0, 8)}. Earlier versions are
                            retained.
                          </p>
                        )}
                        <ul className="claim-evidence-links">
                          {claim.links?.map((link) => {
                            const source = sources.find((item) => item.id === link.evidence_id);
                            return (
                              <li key={`${link.evidence_id}:${link.relation}`}>
                                <span className={`relation relation-${link.relation}`}>
                                  {link.relation}
                                </span>
                                <a href={evidenceUrl(link.evidence_id)}>
                                  {source?.title ??
                                    `Inspect source ${link.evidence_id.slice(0, 8)}`}
                                </a>
                                {source && (
                                  <small>
                                    {availabilityLabels[source.availability ?? "available"]}
                                  </small>
                                )}
                                {link.rationale && <p>{link.rationale}</p>}
                                {link.location?.page_start && (
                                  <p className="field-hint">
                                    Page {link.location.page_start}
                                    {link.location.page_end && `–${link.location.page_end}`}
                                  </p>
                                )}
                                {link.location?.excerpt && (
                                  <blockquote>{link.location.excerpt}</blockquote>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                        {!claim.links?.length && <p className="field-hint">No evidence linked.</p>}
                      </article>
                    ))
                  ) : (
                    <p className="muted">
                      {selectedClaims
                        ? "No loaded claims link to this source."
                        : "Add a hypothesis, observation, or interpretation, then link supporting and contradicting sources."}
                    </p>
                  )}
                  {nextClaim !== null && (
                    <Button className="button small" onClick={() => more("claims")}>
                      Load more claims
                    </Button>
                  )}
                </section>
              )}
            </div>
          }
        />
      )}
    </section>
  );
}
