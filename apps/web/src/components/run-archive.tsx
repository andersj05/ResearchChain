import { useEffect, useRef, useState } from "react";
import { ownerStoragePrefix } from "@/lib/access";
import { api, type RunArchivePage, type RunSummary } from "@/lib/workflow";
import { useOwner } from "./access-context";
import { formatTime, RunStatus, runStatusLabels } from "./run-status";
import { sessionUrl, sourceLedBrief } from "@/lib/research-sessions";
import "./run-archive.css";

type ArchiveCursor = Pick<RunSummary, "created_at" | "id">;
type ArchiveView = { open: boolean; search: string; status: string; cursors: ArchiveCursor[] };
type Pagination = { cursors: ArchiveCursor[]; onChange: (cursors: ArchiveCursor[]) => void };
const defaultView: ArchiveView = { open: false, search: "", status: "", cursors: [] };
const searchLimit = 200;

function isArchiveCursor(value: unknown): value is ArchiveCursor {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value.id) &&
    "created_at" in value &&
    typeof value.created_at === "string" &&
    /T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value.created_at) &&
    Number.isFinite(Date.parse(value.created_at))
  );
}

function readArchiveView(key: string | undefined): ArchiveView {
  if (!key) return defaultView;
  try {
    const view: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (
      typeof view === "object" &&
      view !== null &&
      "open" in view &&
      typeof view.open === "boolean" &&
      "search" in view &&
      typeof view.search === "string" &&
      view.search.length <= searchLimit &&
      "status" in view &&
      typeof view.status === "string" &&
      (!view.status || Object.hasOwn(runStatusLabels, view.status)) &&
      "cursors" in view &&
      Array.isArray(view.cursors) &&
      view.cursors.every(isArchiveCursor)
    ) {
      return {
        open: view.open,
        search: view.search,
        status: view.status,
        cursors: view.cursors.map(({ id, created_at }) => ({ id, created_at })),
      };
    }
  } catch {
    // Browsing the archive does not depend on storage access.
  }
  return defaultView;
}

function ArchiveResults({
  query,
  busy,
  onSelect,
  pagination,
}: {
  query: string;
  busy: boolean;
  onSelect?: (run: RunSummary) => void;
  pagination?: Pagination;
}) {
  const [localCursors, setLocalCursors] = useState<ArchiveCursor[]>([]);
  const cursors = pagination?.cursors ?? localCursors;
  const setCursors = pagination?.onChange ?? setLocalCursors;
  const [retry, setRetry] = useState(0);
  const [response, setResponse] = useState<{ path: string; page: RunArchivePage | null }>();
  const results = useRef<HTMLDivElement>(null);
  const params = new URLSearchParams(query);
  const sessionsOnly = params.get("sessions_only") === "true";
  const filtered = Boolean(params.get("search") || params.get("status"));
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
    <div className="archive-results" ref={results} tabIndex={pagination ? -1 : undefined}>
      {!current ? (
        <p role="status">{sessionsOnly ? "Searching studies…" : "Searching saved runs…"}</p>
      ) : !page ? (
        <div role="alert" className="actions">
          {sessionsOnly ? "Could not search studies." : "Could not search saved runs."}
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
        <ul aria-label={sessionsOnly ? "Saved studies" : "Saved runs"}>
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
                {brief_excerpt && (!run.study_title || brief_excerpt !== sourceLedBrief) && (
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
      ) : pagination && cursors.length ? (
        <div className="actions">
          <p className="muted" role="status">
            This page has no saved studies.
          </p>
          <button
            className="button small"
            type="button"
            onClick={() => {
              results.current?.focus({ preventScroll: true });
              setCursors([]);
            }}
          >
            Back to first page
          </button>
        </div>
      ) : (
        <p className="muted" role="status">
          {sessionsOnly
            ? filtered
              ? "No studies match these filters."
              : "No saved studies yet."
            : "No saved runs match these filters."}
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
              if (last) setCursors([...cursors, { id: last.id, created_at: last.created_at }]);
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
  expanded = false,
  busy = false,
  onSelect,
}: {
  agentId?: string | null;
  excludeRun?: string;
  sessionsOnly?: boolean;
  expanded?: boolean;
  busy?: boolean;
  onSelect?: (run: RunSummary) => void;
}) {
  const { owner, active } = useOwner();
  const storageKey = sessionsOnly ? `${ownerStoragePrefix(owner)}.research.archive.v1` : undefined;
  const [view, setView] = useState(() => readArchiveView(active ? storageKey : undefined));
  const disclosure = useRef<HTMLElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState(view.search);
  const [status, setStatus] = useState(view.status);
  const [revision, setRevision] = useState(0);
  function updateView(next: ArchiveView) {
    setView(next);
    if (!storageKey || !active) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // The controls continue to work for the current page.
    }
  }
  function submit(search: string, status: string) {
    updateView({ ...view, search: search.trim(), status, cursors: [] });
    setRevision((value) => value + 1);
  }
  const query = new URLSearchParams({ search: view.search });
  if (sessionsOnly) query.set("sessions_only", "true");
  if (view.status) query.set("status", view.status);
  if (agentId) query.set("agent_id", agentId);
  if (excludeRun) {
    query.set("exclude_id", excludeRun);
    if (!agentId) query.set("unassigned", "true");
  }
  const choose = (run: RunSummary) => {
    disclosure.current?.focus();
    onSelect?.(run);
    updateView({ ...view, open: false });
  };
  const canReset =
    sessionsOnly && Boolean(search || status || view.search || view.status || view.cursors.length);

  const content = (expanded || view.open) && (
    <>
      <form
        className="archive-search"
        onSubmit={(event) => {
          event.preventDefault();
          submit(search, status);
        }}
      >
        <label>
          Search the archive
          <input
            ref={searchInput}
            type="search"
            value={search}
            maxLength={searchLimit}
            placeholder={
              sessionsOnly
                ? "Study title, source, context, or ID"
                : "Brief, agent, workflow, or run ID"
            }
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="archive-controls">
          <label>
            {sessionsOnly ? "Study status" : "Saved run status"}
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(runStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="actions">
            <button className="button small" type="submit">
              Search
            </button>
            {canReset && (
              <button
                className="button small"
                type="button"
                onClick={() => {
                  setSearch("");
                  setStatus("");
                  submit("", "");
                  searchInput.current?.focus();
                }}
              >
                Reset search
              </button>
            )}
          </div>
        </div>
      </form>
      <ArchiveResults
        key={`${query}:${revision}`}
        query={query.toString()}
        busy={busy}
        onSelect={onSelect ? choose : undefined}
        pagination={
          sessionsOnly
            ? { cursors: view.cursors, onChange: (cursors) => updateView({ ...view, cursors }) }
            : undefined
        }
      />
    </>
  );
  if (expanded) return <div className="run-archive archive-expanded">{content}</div>;

  return (
    <details
      className="run-archive"
      open={view.open}
      onToggle={(event) => {
        const open = event.currentTarget.open;
        if (open !== view.open) updateView({ ...view, open });
      }}
    >
      <summary ref={disclosure}>
        {sessionsOnly
          ? "Search past studies"
          : excludeRun
            ? "Search comparison runs"
            : "Search saved runs"}
      </summary>
      {content}
    </details>
  );
}
