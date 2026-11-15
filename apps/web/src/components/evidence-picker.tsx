"use client";

import { useEffect, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { api } from "@/lib/workflow";
import { availabilityLabels, type EvidencePage, type EvidenceRecord } from "@/lib/evidence";

export function EvidencePicker({
  selected,
  onChange,
  disabled = false,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [items, setItems] = useState<EvidenceRecord[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [initialSelection] = useState(selected);
  useEffect(() => {
    let active = true;
    api<EvidencePage>("evidence?limit=50")
      .then(async (page) => {
        const retained = await Promise.all(
          initialSelection
            .filter((id) => !page.items.some((item) => item.id === id))
            .map((id) => api<EvidenceRecord>(`evidence/${encodeURIComponent(id)}`)),
        );
        if (active) {
          setItems([...retained, ...page.items]);
          setNext(page.next_offset ?? null);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load evidence.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
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
  const visible = items.filter((item) => item.title.toLowerCase().includes(search.toLowerCase()));
  return (
    <fieldset className="evidence-picker" disabled={disabled}>
      <legend>
        Evidence for this run <span className="count">{selected.length}</span>
      </legend>
      <p className="field-hint">
        Selected records stay pinned. Missing sources remain marked as unavailable.
      </p>
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
            <span>
              <strong>{item.title}</strong>
              <small>{availabilityLabels[item.availability ?? "available"]}</small>
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
