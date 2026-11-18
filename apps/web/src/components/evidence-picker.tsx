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
  const [items, setItems] = useState<EvidenceRecord[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [initialSelection] = useState(selected);
  const pickerId = useId();
  useEffect(() => {
    let active = true;
    async function load() {
      let page: EvidencePage | undefined;
      try {
        page = await api<EvidencePage>("evidence?limit=50");
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load evidence.");
      }
      if (!active) return;
      const recent = page?.items ?? [];
      const retained = await readSources(
        initialSelection.filter((id) => !recent.some((item) => item.id === id)),
      );
      if (active) {
        setItems([...retained, ...recent]);
        setNext(page?.next_offset ?? null);
        setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [initialSelection]);
  async function more() {
    setError("");
    setLoading(true);
    try {
      const page = await api<EvidencePage>(`evidence?limit=50&offset=${next ?? 0}`);
      setItems((previous) => [
        ...new Map([...previous, ...page.items].map((item) => [item.id, item])).values(),
      ]);
      setNext(page.next_offset ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load evidence.");
    } finally {
      setLoading(false);
    }
  }
  const query = search.trim().toLowerCase();
  const visible = items.filter((item) => item.title.toLowerCase().includes(query));
  const byId = new Map(items.map((item) => [item.id, item]));
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
                        : loading
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
          {!loading && unresolved.length > 0 && (
            <Button
              className="button small"
              onClick={async () => {
                const recovered = await readSources(unresolved);
                setItems((previous) => [
                  ...new Map([...recovered, ...previous].map((item) => [item.id, item])).values(),
                ]);
              }}
            >
              Retry selected source details
            </Button>
          )}
        </details>
      )}
      {items.length > 5 && (
        <input
          aria-label="Filter loaded evidence"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter loaded sources…"
        />
      )}
      <div className="evidence-options">
        {visible.map((item) => (
          <label className="evidence-option" key={item.id}>
            <input
              type="checkbox"
              aria-labelledby={`${pickerId}-${item.id}-name`}
              aria-describedby={`${pickerId}-${item.id}-details`}
              checked={selected.includes(item.id)}
              disabled={disabled || (selected.length >= 100 && !selected.includes(item.id))}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, item.id]
                    : selected.filter((id) => id !== item.id),
                )
              }
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
        {!loading && !items.length && (
          <p className="muted">Add sources in the Evidence tab to include them here.</p>
        )}
        {!loading && items.length > 0 && !visible.length && (
          <p className="muted">No matching loaded sources.</p>
        )}
      </div>
      {loading && (
        <p className="muted" role="status">
          Loading evidence…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {(next !== null || error) && (
        <Button className="button small" disabled={loading || disabled} onClick={more}>
          {error ? "Retry sources" : "Load more sources"}
        </Button>
      )}
    </fieldset>
  );
}
