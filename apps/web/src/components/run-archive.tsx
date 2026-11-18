import { useEffect, useRef, useState } from "react";
import { api, type RunArchivePage, type RunSummary } from "@/lib/workflow";
import { formatTime, RunStatus, runStatusLabels } from "./run-status";

function ArchiveResults({
  query,
  busy,
  onSelect,
}: {
  query: string;
  busy: boolean;
  onSelect: (run: RunSummary) => void;
}) {
  const [cursors, setCursors] = useState<RunSummary[]>([]);
  const [retry, setRetry] = useState(0);
  const [response, setResponse] = useState<{ path: string; page: RunArchivePage | null }>();
  const params = new URLSearchParams(query);
  const cursor = cursors.at(-1);
  if (cursor) {
    params.set("before_created_at", cursor.created_at);
    params.set("before_id", cursor.id);
  }
  const path = `runs/search?${params}`;
  const current = response?.path === path ? response : undefined;
  const page = current?.page;

  useEffect(() => {
    let active = true;
    api<RunArchivePage>(path).then(
      (page) => {
        if (active) setResponse({ path, page });
      },
      () => {
        if (active) setResponse({ path, page: null });
      },
    );
    return () => {
      active = false;
    };
  }, [path, retry]);

  return (
    <div className="archive-results">
      {!current ? (
        <p role="status">Searching saved runs…</p>
      ) : !page ? (
        <div role="alert" className="actions">
          Could not search saved runs.
          <button
            className="button small"
            type="button"
            onClick={() => {
              setResponse(undefined);
              setRetry(retry + 1);
            }}
          >
            Retry search
          </button>
        </div>
      ) : page.items.length ? (
        <ul aria-label="Saved runs">
          {page.items.map(({ run, brief_excerpt }) => (
            <li key={run.id}>
              <button
                className="run-row"
                type="button"
                disabled={busy}
                onClick={() => onSelect(run)}
              >
                <strong>{run.workflow_name}</strong>
                <span className="run-row-meta">
                  <RunStatus status={run.status} />
                  <time dateTime={run.created_at}>{formatTime(run.created_at, true)}</time>
                </span>
                <span className="run-row-meta">
                  <span>
                    {run.agent_name !== run.workflow_name && `${run.agent_name ?? "Unassigned"} · `}
                    Revision {run.revision_number}
                  </span>
                  <span className="code-label">{run.id.slice(0, 8)}</span>
                </span>
                {brief_excerpt && <span className="archive-brief">{brief_excerpt}</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted" role="status">
          No saved runs match these filters.
        </p>
      )}
      {(cursors.length > 0 || page?.has_more) && (
        <div className="actions archive-paging">
          <button
            className="button small"
            type="button"
            disabled={cursors.length === 0}
            onClick={() => setCursors(cursors.slice(0, -1))}
          >
            Previous page
          </button>
          <span className="muted">Page {cursors.length + 1}</span>
          <button
            className="button small"
            type="button"
            disabled={!page?.has_more}
            onClick={() => {
              const last = page?.items.at(-1)?.run;
              if (last) setCursors([...cursors, last]);
            }}
          >
            Next page
          </button>
        </div>
      )}
    </div>
  );
}

export function RunArchive({
  agentId,
  excludeRun,
  busy = false,
  onSelect,
}: {
  agentId?: string | null;
  excludeRun?: string;
  busy?: boolean;
  onSelect: (run: RunSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const disclosure = useRef<HTMLElement>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [searchRequest, setSearchRequest] = useState({ search: "", status: "", revision: 0 });
  const query = new URLSearchParams({ search: searchRequest.search });
  if (searchRequest.status) query.set("status", searchRequest.status);
  if (agentId) query.set("agent_id", agentId);
  if (excludeRun) {
    query.set("exclude_id", excludeRun);
    if (!agentId) query.set("unassigned", "true");
  }
  const choose = (run: RunSummary) => {
    disclosure.current?.focus();
    onSelect(run);
    setOpen(false);
  };

  return (
    <details
      className="run-archive"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary ref={disclosure}>
        {excludeRun ? "Search comparison runs" : "Search saved runs"}
      </summary>
      {open && (
        <>
          <form
            className="archive-search"
            onSubmit={(event) => {
              event.preventDefault();
              setSearchRequest({
                search: search.trim(),
                status,
                revision: searchRequest.revision + 1,
              });
            }}
          >
            <label>
              Search the archive
              <input
                type="search"
                value={search}
                maxLength={200}
                placeholder="Brief, agent, workflow, or run ID"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="archive-controls">
              <label>
                Saved run status
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="">All statuses</option>
                  {Object.entries(runStatusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="button small" type="submit">
                Search
              </button>
            </div>
          </form>
          <ArchiveResults
            key={`${query}:${searchRequest.revision}`}
            query={query.toString()}
            busy={busy}
            onSelect={choose}
          />
        </>
      )}
    </details>
  );
}
