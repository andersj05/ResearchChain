"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { api } from "@/lib/workflow";
import {
  availabilityLabels,
  evidenceUrl,
  representationLabels,
  type EvidencePage,
  type EvidenceRecord,
} from "@/lib/evidence";

type SearchResults = {
  query: string;
  generation: number;
  items: EvidenceRecord[];
  next: number | null;
  error?: string;
};

function listSources(query: string, offset = 0) {
  const params = new URLSearchParams({ limit: "50" });
  if (offset) params.set("offset", String(offset));
  if (query) params.set("search", query);
  return api<EvidencePage>(`evidence?${params}`);
}

function mergeSources(first: EvidenceRecord[], second: EvidenceRecord[]) {
  return [...new Map([...first, ...second].map((item) => [item.id, item])).values()];
}

async function readSources(ids: string[]) {
  const results = await Promise.allSettled(
    ids.map((id) => api<EvidenceRecord>(`evidence/${encodeURIComponent(id)}`)),
  );
  return results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

function sourceMetadata(item: EvidenceRecord) {
  return [
    representationLabels[item.representation ?? "original"],
    item.as_of_date
      ? `As of ${item.as_of_date}`
      : item.published_date && `Published ${item.published_date}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function EvidencePicker({
  selected,
  onChange,
  disabled = false,
  label = "Evidence for this run",
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [search, setSearch] = useState("");
  const [generation, setGeneration] = useState(0);
  const [results, setResults] = useState<SearchResults>();
  const [pendingPage, setPendingPage] = useState<SearchResults>();
  const [retained, setRetained] = useState<EvidenceRecord[]>([]);
  const [initialSelection] = useState(selected);
  const [loadingDetails, setLoadingDetails] = useState(initialSelection.length > 0);
  const pickerId = useId();
  const query = search.trim();
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const page = await listSources(query);
        if (active)
          setResults({ query, generation, items: page.items, next: page.next_offset ?? null });
      } catch (cause) {
        if (active)
          setResults({
            query,
            generation,
            items: [],
            next: null,
            error: cause instanceof Error ? cause.message : "Unable to load evidence.",
          });
      }
    }
    const timer = setTimeout(load, query ? 200 : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [generation, query]);

  useEffect(() => {
    if (!initialSelection.length) return;
    let active = true;
    void readSources(initialSelection).then((records) => {
      if (active) {
        setRetained((previous) => mergeSources(records, previous));
        setLoadingDetails(false);
      }
    });
    return () => {
      active = false;
    };
  }, [initialSelection]);

  const current =
    results?.query === query && results.generation === generation ? results : undefined;
  const loading = !current || pendingPage === current;
  async function more() {
    if (!current) return;
    if (current.next === null) {
      setGeneration((value) => value + 1);
      return;
    }
    setPendingPage(current);
    try {
      const page = await listSources(query, current.next);
      setResults((latest) =>
        latest === current
          ? {
              query,
              generation,
              items: mergeSources(current.items, page.items),
              next: page.next_offset ?? null,
            }
          : latest,
      );
    } catch (cause) {
      setResults((latest) =>
        latest === current
          ? {
              ...current,
              error: cause instanceof Error ? cause.message : "Unable to load evidence.",
            }
          : latest,
      );
    } finally {
      setPendingPage((pending) => (pending === current ? undefined : pending));
    }
  }
  const resultsItems = current?.items ?? [];
  const known = mergeSources(retained, resultsItems);
  const visible = query ? resultsItems : known;
  const byId = new Map(known.map((item) => [item.id, item]));
  const unresolved = selected.filter((id) => !byId.has(id));
  const remove = (id: string) => onChange(selected.filter((value) => value !== id));
  return (
    <fieldset className="evidence-picker" disabled={disabled}>
      <legend>
        {label} <span className="count">{selected.length}</span>
      </legend>
      {selected.length > 0 && (
        <details className="evidence-selected">
          <summary>Selected sources ({selected.length})</summary>
          <ul>
            {selected.map((id) => {
              const item = byId.get(id);
              return (
                <li key={id}>
                  <div>
                    <a href={evidenceUrl(id)} target="_blank" rel="noopener">
                      {item?.title ?? `Source ${id.slice(0, 8)}`}
                    </a>
                    <small>
                      {item
                        ? `${availabilityLabels[item.availability ?? "available"]} · ${sourceMetadata(item)}`
                        : loadingDetails
                          ? "Loading source details…"
                          : "Source details unavailable"}
                    </small>
                  </div>
                  <Button
                    className="button small"
                    aria-label={`Remove ${item?.title ?? `source ${id.slice(0, 8)}`}`}
                    onClick={() => remove(id)}
                  >
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
          {!loadingDetails && unresolved.length > 0 && (
            <Button
              className="button small"
              onClick={async () => {
                const recovered = await readSources(unresolved);
                setRetained((previous) => mergeSources(recovered, previous));
              }}
            >
              Retry selected source details
            </Button>
          )}
        </details>
      )}
      <input
        aria-label="Search evidence library"
        type="search"
        maxLength={240}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
        placeholder="Title, author, publisher, or date"
      />
      <div className="evidence-options">
        {visible.map((item) => (
          <label className="evidence-option" key={item.id}>
            <input
              type="checkbox"
              aria-labelledby={`${pickerId}-${item.id}-name`}
              aria-describedby={`${pickerId}-${item.id}-details`}
              checked={selected.includes(item.id)}
              disabled={disabled || (selected.length >= 100 && !selected.includes(item.id))}
              onChange={(event) => {
                if (event.target.checked) {
                  setRetained((previous) => mergeSources(previous, [item]));
                  onChange([...selected, item.id]);
                } else remove(item.id);
              }}
            />
            <span className="evidence-option-copy">
              <span id={`${pickerId}-${item.id}-name`}>
                <strong>{item.title}</strong>
                <small>{availabilityLabels[item.availability ?? "available"]}</small>
              </span>
              <small id={`${pickerId}-${item.id}-details`}>{sourceMetadata(item)}</small>
            </span>
          </label>
        ))}
        {!loading && !current?.error && !visible.length && (
          <p className="muted">
            {query
              ? "No matching sources."
              : "Add sources in the Evidence tab to include them here."}
          </p>
        )}
      </div>
      {loading && (
        <p className="muted" role="status">
          Loading evidence…
        </p>
      )}
      {current?.error && (
        <p className="error" role="alert">
          {current.error}
        </p>
      )}
      {current && (current.next !== null || current.error) && (
        <Button className="button small" disabled={loading || disabled} onClick={more}>
          {current.error ? "Retry sources" : "Load more sources"}
        </Button>
      )}
    </fieldset>
  );
}
