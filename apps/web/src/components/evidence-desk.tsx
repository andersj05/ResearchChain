"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { api } from "@/lib/workflow";
import {
  listSources,
  mergeSources,
  useEvidenceLibrary,
  type EvidenceAvailability,
} from "@/lib/use-evidence-library";
import {
  availabilityLabels,
  evidenceUrl,
  representationLabels,
  sourceTypeLabels,
  type ClaimPage,
  type ClaimRecord,
  type EvidenceKind,
  type EvidenceRecord,
} from "@/lib/evidence";
import { CollectionLayout, useCompactCollectionLayout } from "@/components/collection-layout";
import { EvidenceForm } from "@/components/evidence-form";
import { EvidenceDetail } from "@/components/evidence-detail";
import { ClaimForm } from "@/components/claim-form";

export function EvidenceDesk() {
  const desk = useRef<HTMLElement>(null);
  const sourceList = useRef<HTMLElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const inspection = useRef<HTMLDivElement>(null);
  const inspectionTitle = useRef<HTMLHeadingElement>(null);
  const revealInspection = useRef(false);
  const compact = useCompactCollectionLayout();
  const [sources, setSources] = useState<EvidenceRecord[]>([]);
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [selection, setSelection] = useState<{
    record: EvidenceRecord;
    fromResults: boolean;
  } | null>(null);
  const selected = selection?.record ?? null;
  const [nextSource, setNextSource] = useState<number | null>(null);
  const [nextClaim, setNextClaim] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [form, setForm] = useState<"source" | "claim" | null>(null);
  const [correcting, setCorrecting] = useState<EvidenceRecord>();
  const [revising, setRevising] = useState<ClaimRecord>();
  const [search, setSearch] = useState("");
  const [availability, setAvailability] = useState<EvidenceAvailability>();
  const [sourceType, setSourceType] = useState<EvidenceKind>();
  const [selectedClaims, setSelectedClaims] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadEpoch, setLoadEpoch] = useState(0);
  const query = search.trim();
  const filtered = Boolean(query || availability || sourceType);
  const library = useEvidenceLibrary(query, availability, filtered, sourceType);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [page, claimPage] = await Promise.all([
          listSources(),
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
        setSelection(initial ? { record: initial, fromResults: false } : null);
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
    const reveal = revealInspection.current;
    revealInspection.current = false;
    if (reveal && !form) {
      inspectionTitle.current?.focus({ preventScroll: true });
      inspection.current?.scrollIntoView({ block: "start" });
      return;
    }
    desk.current?.parentElement?.scrollTo({ top: 0 });
  }, [form, selection]);

  function select(record: EvidenceRecord, fromList = false) {
    const fromResults = fromList && compact;
    revealInspection.current = fromResults;
    setSelection({ record, fromResults });
    setForm(null);
    setMessage("");
    const url = new URL(window.location.href);
    url.searchParams.set("evidence", record.id);
    window.history.replaceState(null, "", url);
  }
  function returnToSourceResults(id: string) {
    const row = sourceList.current?.querySelector<HTMLButtonElement>(
      `[data-source-id="${CSS.escape(id)}"]`,
    );
    const target = row ?? searchInput.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });
  }
  function clearFilters() {
    setSearch("");
    setAvailability(undefined);
    setSourceType(undefined);
    library.refresh();
    searchInput.current?.focus();
  }
  function sourceSaved(record: EvidenceRecord) {
    setSources((previous) => [record, ...previous.filter((item) => item.id !== record.id)]);
    setTotal((previous) => previous + (sources.some((item) => item.id === record.id) ? 0 : 1));
    if (nextSource !== null) setNextSource(nextSource + 1);
    if (filtered) library.refresh();
    select(record);
    setMessage("Source saved. Original content and provenance are preserved.");
  }
  async function more(kind: "evidence" | "claims") {
    setError("");
    try {
      if (kind === "evidence") {
        const page = await listSources("", undefined, nextSource ?? 0);
        setSources((previous) => mergeSources(previous, page.items));
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
  const visible = filtered ? library.items : sources;
  const formSources = mergeSources(
    mergeSources(sources, library.items),
    selected ? [selected] : [],
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
            <aside className="source-list" ref={sourceList} aria-label="Sources">
              <label htmlFor="source-search">Find a source</label>
              <input
                id="source-search"
                ref={searchInput}
                type="search"
                maxLength={240}
                placeholder="Title, author, publisher, or date"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <div className="source-list-filters">
                <div>
                  <label htmlFor="source-availability-filter">Availability</label>
                  <select
                    id="source-availability-filter"
                    value={availability ?? "all"}
                    onChange={(event) =>
                      setAvailability(
                        event.target.value === "all"
                          ? undefined
                          : (event.target.value as EvidenceAvailability),
                      )
                    }
                  >
                    <option value="all">All sources</option>
                    {Object.entries(availabilityLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="source-type-filter">Source type</label>
                  <select
                    id="source-type-filter"
                    value={sourceType ?? ""}
                    onChange={(event) => {
                      const value = event.currentTarget.value as EvidenceKind | "";
                      setSourceType(value || undefined);
                      library.refresh();
                    }}
                  >
                    <option value="">All types</option>
                    {Object.entries(sourceTypeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {filtered && (
                <button
                  type="button"
                  className="button small clear-source-filters"
                  onClick={clearFilters}
                >
                  Clear filters
                </button>
              )}
              {library.loading ? (
                <p className="collection-count" role="status">
                  Finding sources…
                </p>
              ) : (
                !library.error && (
                  <p className="collection-count">
                    {filtered
                      ? `${visible.length} of ${library.total} matches loaded`
                      : `${sources.length} of ${total} sources loaded`}
                  </p>
                )
              )}
              <div className="source-list-items">
                {visible.map((source) => (
                  <button
                    key={source.id}
                    data-source-id={source.id}
                    className={`source-list-item ${selected?.id === source.id && !form ? "selected" : ""}`}
                    aria-pressed={selected?.id === source.id && !form}
                    onClick={() => select(source, true)}
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
              {!filtered && !sources.length && (
                <p className="muted">
                  No sources yet. Add a permitted report, chart, dataset, discussion, or link.
                </p>
              )}
              {filtered && !library.loading && !library.error && !visible.length && (
                <p className="muted">No matching sources.</p>
              )}
              {library.error && (
                <p className="error" role="alert">
                  {library.error}
                </p>
              )}
              {(filtered ? library.hasMore || library.error : nextSource !== null) && (
                <Button
                  className="button small"
                  disabled={library.loading}
                  onClick={filtered ? library.more : () => more("evidence")}
                >
                  {library.error ? "Retry source search" : "Load more sources"}
                </Button>
              )}
            </aside>
          }
          detail={
            <div className="evidence-main" ref={inspection}>
              {form === "source" ? (
                <EvidenceForm
                  key={correcting?.id ?? "new"}
                  sources={formSources}
                  original={correcting}
                  onSaved={sourceSaved}
                  onCancel={() => setForm(null)}
                />
              ) : form === "claim" ? (
                <ClaimForm
                  key={revising?.id ?? "new"}
                  sources={formSources}
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
                  titleRef={inspectionTitle}
                  onBackToResults={
                    compact && selection?.fromResults
                      ? () => returnToSourceResults(selected.id)
                      : undefined
                  }
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
