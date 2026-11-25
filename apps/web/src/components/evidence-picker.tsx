"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@ui-sdk/react/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import { mergeSources, readSources, useEvidenceLibrary } from "@/lib/use-evidence-library";
import {
  availabilityLabels,
  evidenceUrl,
  sourceMetadata,
  sourceTypeLabels,
  type EvidenceKind,
  type EvidenceRecord,
} from "@/lib/evidence";

const sourceLimit = 100;

export function EvidencePicker({
  selected,
  onChange,
  onAdd,
  allowBatchPin = false,
  allowKindFilter = false,
  disabled = false,
  label = "Evidence for this run",
  onAttachChart,
  attachedCharts = [],
  showSelected = true,
  renderResultAction,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  onAdd?: (record: EvidenceRecord) => void;
  allowBatchPin?: boolean;
  allowKindFilter?: boolean;
  disabled?: boolean;
  label?: string;
  onAttachChart?: (known: EvidenceRecord[]) => void;
  attachedCharts?: EvidenceRecord[];
  showSelected?: boolean;
  renderResultAction?: (item: EvidenceRecord, visible: EvidenceRecord[]) => ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<EvidenceKind | "">("");
  const [retained, setRetained] = useState<EvidenceRecord[]>([]);
  const [initialSelection] = useState(showSelected ? selected : []);
  const [loadingDetails, setLoadingDetails] = useState(initialSelection.length > 0);
  const [orderMessage, setOrderMessage] = useState("");
  const moveFocus = useRef<string>(null);
  const pickerId = useId();
  const query = search.trim();
  const filterKind = allowKindFilter && kind ? kind : undefined;
  const hasFilters = Boolean(query || filterKind);
  const library = useEvidenceLibrary(query, undefined, true, filterKind);

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
  const visible = hasFilters ? library.items : known;
  const byId = new Map(known.map((item) => [item.id, item]));
  const selectedIds = new Set(selected);
  const batch =
    allowBatchPin && hasFilters && visible.length > 1
      ? visible.filter((item) => !selectedIds.has(item.id))
      : null;
  const slots = Math.max(0, sourceLimit - selected.length);
  const overCapacity = !!batch && batch.length > slots;
  const batchHint = overCapacity
    ? slots
      ? `${slots} packet ${slots === 1 ? "slot" : "slots"} left. Narrow the search or pin sources individually.`
      : `Packet holds ${sourceLimit} sources. Unpin a source to make room.`
    : library.hasMore
      ? `${visible.length} of ${library.total} results loaded.`
      : "";
  const unresolved = selected.filter((id) => !byId.has(id));
  const remove = (id: string) => onChange(selected.filter((value) => value !== id));
  function add(items: EvidenceRecord[]) {
    setRetained((previous) => mergeSources(previous, items));
    if (onAdd) items.forEach(onAdd);
    else onChange([...selected, ...items.map((item) => item.id)]);
  }
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

  const searchField = (
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
  );
  return (
    <fieldset className="evidence-picker" disabled={disabled}>
      <legend>
        {label} <span className="count">{selected.length}</span>
      </legend>
      {onAttachChart && (
        <Button
          className="button small"
          disabled={disabled || !slots}
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
      {allowKindFilter ? (
        <div className="evidence-search-filters">
          {searchField}
          <label>
            Source type
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.currentTarget.value as EvidenceKind | "");
                library.refresh();
              }}
            >
              <option value="">All types</option>
              {Object.entries(sourceTypeLabels).map(([value, title]) => (
                <option key={value} value={value}>
                  {title}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        searchField
      )}
      {batch && (
        <div className="actions field-hint">
          <Button
            className="button small"
            disabled={disabled || library.loading || !batch.length || overCapacity}
            focusableWhenDisabled={!disabled}
            aria-describedby={batchHint ? `${pickerId}-batch-hint` : undefined}
            onClick={() => add(batch)}
          >
            {batch.length
              ? `Pin ${batch.length} loaded ${batch.length === 1 ? "result" : "results"}`
              : "Loaded results pinned"}
          </Button>
          {batchHint && <span id={`${pickerId}-batch-hint`}>{batchHint}</span>}
        </div>
      )}
      <div className="evidence-options">
        {visible.map((item) => {
          const label = (
            <label className="evidence-option" key={item.id}>
              <input
                type="checkbox"
                aria-labelledby={`${pickerId}-${item.id}-name`}
                aria-describedby={`${pickerId}-${item.id}-details`}
                checked={selectedIds.has(item.id)}
                disabled={disabled || (!slots && !selectedIds.has(item.id))}
                onChange={(event) => {
                  if (event.target.checked) add([item]);
                  else remove(item.id);
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
          );
          const action = renderResultAction?.(item, visible);
          return action ? (
            <div key={item.id} className="evidence-option-row">
              {label}
              {action}
            </div>
          ) : (
            label
          );
        })}
        {!library.loading && !library.error && !visible.length && (
          <p className="muted">{hasFilters ? "No matching sources." : "No saved sources yet."}</p>
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
