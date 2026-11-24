"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import { mergeSources, readSources, useEvidenceLibrary } from "@/lib/use-evidence-library";
import {
  availabilityLabels,
  evidenceUrl,
  sourceMetadata,
  type EvidenceRecord,
} from "@/lib/evidence";

export function EvidencePicker({
  selected,
  onChange,
  disabled = false,
  label = "Evidence for this run",
  onAttachChart,
  attachedCharts = [],
  showSelected = true,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  label?: string;
  onAttachChart?: (known: EvidenceRecord[]) => void;
  attachedCharts?: EvidenceRecord[];
  showSelected?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [retained, setRetained] = useState<EvidenceRecord[]>([]);
  const [initialSelection] = useState(showSelected ? selected : []);
  const [loadingDetails, setLoadingDetails] = useState(initialSelection.length > 0);
  const [orderMessage, setOrderMessage] = useState("");
  const moveFocus = useRef<string>(null);
  const pickerId = useId();
  const query = search.trim();
  const library = useEvidenceLibrary(query);

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

  useLayoutEffect(() => {
    if (!moveFocus.current) return;
    document.getElementById(moveFocus.current)?.focus();
    moveFocus.current = null;
  }, [selected]);

  const known = mergeSources([...attachedCharts, ...retained], library.items);
  const visible = query ? library.items : known;
  const byId = new Map(known.map((item) => [item.id, item]));
  const unresolved = selected.filter((id) => !byId.has(id));
  const remove = (id: string) => onChange(selected.filter((value) => value !== id));
  function move(index: number, distance: -1 | 1, control: string, title: string) {
    const destination = index + distance;
    const id = selected[index];
    const neighbor = selected[destination];
    if (!id || !neighbor) return;
    const ordered = [...selected];
    ordered[index] = neighbor;
    ordered[destination] = id;
    moveFocus.current = control;
    onChange(ordered);
    setOrderMessage(`${title} moved to position ${destination + 1} of ${selected.length}.`);
  }
  return (
    <fieldset className="evidence-picker" disabled={disabled}>
      <legend>
        {label} <span className="count">{selected.length}</span>
      </legend>
      {onAttachChart && (
        <Button
          className="button small"
          disabled={disabled || selected.length >= 100}
          onClick={() => onAttachChart(known)}
        >
          Upload a chart
        </Button>
      )}
      {showSelected && selected.length > 0 && (
        <details className="evidence-selected">
          <summary>Selected sources ({selected.length})</summary>
          <ul>
            {selected.map((id, index) => {
              const item = byId.get(id);
              const title = item?.title ?? `Source ${id.slice(0, 8)}`;
              const upId = `${pickerId}-${id}-up`;
              const downId = `${pickerId}-${id}-down`;
              return (
                <li key={id}>
                  <div>
                    <a href={evidenceUrl(id)} target="_blank" rel="noopener">
                      {title}
                    </a>
                    <small>
                      {item
                        ? `${availabilityLabels[item.availability ?? "available"]} · ${sourceMetadata(item)}`
                        : loadingDetails
                          ? "Loading source details…"
                          : "Source details unavailable"}
                    </small>
                  </div>
                  <div className="evidence-selected-actions">
                    {selected.length > 1 && (
                      <>
                        <Button
                          id={upId}
                          className="button icon-button"
                          aria-label={`Move ${title} up`}
                          disabled={index === 0}
                          focusableWhenDisabled
                          onClick={() => move(index, -1, upId, title)}
                        >
                          <ChevronUp size={14} aria-hidden />
                        </Button>
                        <Button
                          id={downId}
                          className="button icon-button"
                          aria-label={`Move ${title} down`}
                          disabled={index === selected.length - 1}
                          focusableWhenDisabled
                          onClick={() => move(index, 1, downId, title)}
                        >
                          <ChevronDown size={14} aria-hidden />
                        </Button>
                      </>
                    )}
                    <Button
                      className="button small"
                      aria-label={`Remove ${title}`}
                      onClick={() => remove(id)}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          <span className="sr-only" role="status">
            {orderMessage}
          </span>
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
        {!library.loading && !library.error && !visible.length && (
          <p className="muted">{query ? "No matching sources." : "No saved sources yet."}</p>
        )}
      </div>
      {library.loading && (
        <p className="muted" role="status">
          Loading evidence…
        </p>
      )}
      {library.error && (
        <p className="error" role="alert">
          {library.error}
        </p>
      )}
      {(library.hasMore || library.error) && (
        <Button
          className="button small"
          disabled={library.loading || disabled}
          onClick={library.more}
        >
          {library.error ? "Retry sources" : "Load more sources"}
        </Button>
      )}
    </fieldset>
  );
}
