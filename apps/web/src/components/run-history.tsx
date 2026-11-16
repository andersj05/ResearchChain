"use client";

import { useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { formatTime, RunStatus, runStatusLabels } from "@/components/run-inspector";
import type { RunSummary } from "@/lib/workflow";

export function RunHistory({
  runs,
  selected,
  agentName,
  busy,
  loaded,
  onRefresh,
  onOpen,
}: {
  runs: RunSummary[];
  selected?: string;
  agentName?: string;
  busy: boolean;
  loaded: boolean;
  onRefresh: () => void;
  onOpen: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const visible = runs.filter(
    (run) =>
      (status === "all" || run.status === status) &&
      `${run.workflow_name} ${run.agent_name ?? ""} ${run.id}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const reviews = runs.filter((run) => run.status === "paused").length;
  const active = runs.filter((run) => run.status === "queued" || run.status === "running").length;
  return (
    <aside className="run-history" aria-label="Recent runs">
      <div className="section-heading">
        <h2>Recent runs</h2>
        <Button className="button small" disabled={!loaded || busy} onClick={onRefresh}>
          Refresh history
        </Button>
      </div>
      <p className="muted">Latest 20{agentName ? ` for ${agentName}` : " across the workspace"}.</p>
      <div className="run-counts">
        <span>
          <strong>{reviews}</strong> need review
        </span>
        <span>
          <strong>{active}</strong> active
        </span>
      </div>
      <label>
        Find a recent run
        <input
          type="search"
          value={search}
          placeholder="Agent, workflow or run ID…"
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <label>
        Run status
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">All statuses</option>
          {Object.entries(runStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="collection-count">
        {visible.length} shown · {runs.length} loaded
      </p>
      {runs.length ? (
        <ul>
          {visible.map((item) => (
            <li key={item.id}>
              <Button
                className="run-row"
                aria-pressed={selected === item.id}
                disabled={busy}
                onClick={() => onOpen(item.id)}
              >
                <strong>{item.workflow_name}</strong>
                <RunStatus status={item.status} />
                <span className="run-row-meta">
                  <span>{item.agent_name ?? "Unassigned"}</span>
                  <span className="code-label">{item.id.slice(0, 8)}</span>
                </span>
                <span className="run-row-meta">
                  <span>Revision {item.revision_number}</span>
                  <time dateTime={item.created_at}>{formatTime(item.created_at)}</time>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          {loaded
            ? "No runs yet. Open Build and run your agent to start an experiment."
            : "Loading runs…"}
        </p>
      )}
      {runs.length > 0 && !visible.length && (
        <p className="muted">No recent runs match these filters.</p>
      )}
      {selected && !visible.some((run) => run.id === selected) && (
        <p className="field-hint">The open run is outside this list. Its details remain visible.</p>
      )}
    </aside>
  );
}
