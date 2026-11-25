import { useEffect, useRef, useState } from "react";
import { api, type RunArchivePage, type RunSummary } from "@/lib/workflow";
import { formatTime, RunStatus, runStatusLabels } from "./run-status";
import { sessionUrl } from "@/lib/research-sessions";

function ArchiveResults({
  query,
  busy,
  onSelect,
}: {
  query: string;
  busy: boolean;
  onSelect?: (run: RunSummary) => void;
}) {
  const [cursors, setCursors] = useState<RunSummary[]>([]);
  const [retry, setRetry] = useState(0);
  const [response, setResponse] = useState<{ path: string; page: RunArchivePage | null }>();
  const params = new URLSearchParams(query);
  const sessionsOnly = params.get("sessions_only") === "true";
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
          {page.items.map(({ run, brief_excerpt }) => {
            const content = (
              <>
                <strong>{run.study_title || run.workflow_name}</strong>
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
                {brief_excerpt && !run.study_title && (
                  <span className="archive-brief">{brief_excerpt}</span>
                )}
              </>
            );
            return (
              <li key={run.id}>
                {onSelect ? (
                  <button
                    className="run-row"
                    type="button"
                    disabled={busy}
                    onClick={() => onSelect(run)}
                  >
                    {content}
                  </button>
                ) : (
                  <a
                    className="run-row"
                    href={
                      sessionsOnly
                        ? sessionUrl(run.id)
                        : `?view=runs&run=${encodeURIComponent(run.id)}`
                    }
                  >
                    {content}
                  </a>
                )}
              </li>
            );
          })}
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
  sessionsOnly = false,
  busy = false,
  onSelect,
}: {
  agentId?: string | null;
  excludeRun?: string;
  sessionsOnly?: boolean;
  busy?: boolean;
  onSelect?: (run: RunSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const disclosure = useRef<HTMLElement>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [searchRequest, setSearchRequest] = useState({
    search: "",
    status: "",
    revision: 0,
  });
  const query = new URLSearchParams({ search: searchRequest.search });
  if (sessionsOnly) query.set("sessions_only", "true");
  if (searchRequest.status) query.set("status", searchRequest.status);
  if (agentId) query.set("agent_id", agentId);
  if (excludeRun) {
    query.set("exclude_id", excludeRun);
    if (!agentId) query.set("unassigned", "true");
  }
  const choose = (run: RunSummary) => {
    disclosure.current?.focus();
    onSelect?.(run);
    setOpen(false);
  };

  return (
    <details
      className="run-archive"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary ref={disclosure}>
        {sessionsOnly
          ? "Search past studies"
          : excludeRun
            ? "Search comparison runs"
            : "Search saved runs"}
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
                placeholder={
                  sessionsOnly
                    ? "Source title, study context, or study ID"
                    : "Brief, agent, workflow, or run ID"
                }
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
            onSelect={onSelect ? choose : undefined}
          />
        </>
      )}
    </details>
  );
}
