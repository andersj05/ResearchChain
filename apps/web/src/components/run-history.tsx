"use client";

import { type Ref, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@ui-sdk/react/button";
import { formatTime, RunStatus, runStatusLabels } from "@/components/run-status";
import {
  ReviewInbox,
  type ReviewInboxHandle,
  type ReviewInboxOrigin,
} from "@/components/review-inbox";
import { RunArchive } from "@/components/run-archive";
import type { RecentRunSummary } from "@/lib/workflow";

export function RunHistory({
  runs,
  selected,
  agentName,
  agentId,
  busy,
  loaded,
  onRefresh,
  onOpen,
  onOpenReview,
  reviewInboxRef,
}: {
  runs: RecentRunSummary[];
  selected?: string;
  agentName?: string;
  agentId?: string;
  busy: boolean;
  loaded: boolean;
  onRefresh: () => void;
  onOpen: (id: string) => void;
  onOpenReview: (origin: ReviewInboxOrigin) => Promise<boolean>;
  reviewInboxRef: Ref<ReviewInboxHandle>;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [browsingFrom, setBrowsingFrom] = useState<string>();
  const listOpen = !selected || browsingFrom === selected;
  const visible = runs.filter(
    (run) =>
      (status === "all" || run.status === status) &&
      `${run.workflow_name} ${run.agent_name ?? ""} ${run.id} ${run.brief_excerpt ?? ""}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const reviews = runs.filter((run) => run.status === "paused").length;
  const active = runs.filter((run) => run.status === "queued" || run.status === "running").length;
  return (
    <aside className="run-history" aria-label="Recent runs" data-list-open={listOpen}>
      <div className="section-heading">
        <h2>Recent runs</h2>
        {selected && (
          <button
            type="button"
            className="mobile-run-list-toggle"
            aria-controls="recent-run-list"
            aria-expanded={listOpen}
            onClick={() => setBrowsingFrom(listOpen ? undefined : selected)}
          >
            {listOpen ? (
              <ChevronDown size={16} aria-hidden />
            ) : (
              <ChevronRight size={16} aria-hidden />
            )}
            Recent runs
          </button>
        )}
        <Button
          className="button small refresh-history"
          disabled={!loaded || busy}
          onClick={onRefresh}
        >
          Refresh history
        </Button>
      </div>
      <ReviewInbox
        ref={reviewInboxRef}
        activeAgentId={agentId}
        activeAgentName={agentName}
        busy={busy}
        onOpen={onOpenReview}
      />
      <div id="recent-run-list">
        <RunArchive
          agentId={agentId}
          busy={busy}
          onSelect={(run) => {
            setBrowsingFrom(undefined);
            onOpen(run.id);
          }}
        />
        <p className="muted">
          Latest 20{agentName ? ` for ${agentName}` : " across the workspace"}.
        </p>
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
            placeholder="Brief, agent, workflow, or run ID…"
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
                  onClick={() => {
                    setBrowsingFrom(undefined);
                    onOpen(item.id);
                  }}
                >
                  <strong>{item.workflow_name}</strong>
                  <RunStatus status={item.status} />
                  {item.brief_excerpt?.trim() && (
                    <span className="run-row-brief">{item.brief_excerpt}</span>
                  )}
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
              ? agentName
                ? "This agent has no recent runs."
                : "No runs yet. Open Build and run your agent to start an experiment."
              : "Loading runs…"}
          </p>
        )}
        {runs.length > 0 && !visible.length && (
          <p className="muted">No recent runs match these filters.</p>
        )}
        {selected && !visible.some((run) => run.id === selected) && (
          <p className="field-hint">
            The open run is outside this list. Its details remain visible.
          </p>
        )}
      </div>
    </aside>
  );
}
