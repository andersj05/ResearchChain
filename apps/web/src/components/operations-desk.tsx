"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import type { components } from "@researchchain/contracts";
import { useOwner } from "@/components/access-context";
import { RetentionPanel } from "@/components/retention-panel";
import { api } from "@/lib/workflow";

type Snapshot = components["schemas"]["OperationsSnapshot"];

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
  return `${(value / 1024 ** power).toFixed(1)} ${["B", "KiB", "MiB", "GiB"][power]}`;
}

function age(seconds: number | null | undefined) {
  if (seconds == null) return "None pending";
  if (seconds < 60) return "Less than a minute";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr`;
  return `${Math.floor(seconds / 86400)} days`;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{typeof value === "number" ? value.toLocaleString() : value}</dd>
    </div>
  );
}

export function OperationsDesk({ onOpenRuns }: { onOpenRuns: () => void }) {
  const { active } = useOwner();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const epoch = useRef(0);

  useEffect(() => {
    const request = ++epoch.current;
    let current = true;
    if (!active) return;
    api<Snapshot>("operations")
      .then((value) => {
        if (current && request === epoch.current) {
          setSnapshot(value);
          setError("");
        }
      })
      .catch(() => {
        if (current && request === epoch.current)
          setError("Status is unavailable. Check the local services.");
      })
      .finally(() => {
        if (current && request === epoch.current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [active]);

  async function refresh() {
    if (!active || busy) return;
    const request = ++epoch.current;
    setBusy(true);
    setError("");
    try {
      const value = await api<Snapshot>("operations");
      if (request === epoch.current) setSnapshot(value);
    } catch {
      if (request === epoch.current) setError("Status is unavailable. Check the local services.");
    } finally {
      if (request === epoch.current) setBusy(false);
    }
  }

  const attention = snapshot
    ? [
        ...(snapshot.workers.connected_consumers === 0
          ? [
              "No workers connected. Start the local worker with pnpm worker to process queued work.",
            ]
          : []),
        ...(snapshot.queue.awaiting_takeover > 0
          ? [
              "Some commands lost their worker. A connected worker can inspect saved progress and take over.",
            ]
          : []),
        ...(snapshot.queue.interrupted > 0
          ? ["Interrupted commands need review in Runs before explicit recovery."]
          : []),
        ...(snapshot.usage.uncertain_attempts > 0
          ? [
              "Some model attempts have uncertain outcomes. Review those runs before starting new work.",
            ]
          : []),
      ]
    : [];

  return (
    <section className="operations-desk" aria-label="Workspace operations">
      <div className="view-heading">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Operations</h1>
          <p className="muted">Worker activity, stored data and reported model usage.</p>
        </div>
        <Button className="button secondary" onClick={refresh} disabled={busy || !active}>
          {busy ? "Refreshing…" : "Refresh status"}
        </Button>
      </div>
      <p className="operations-observed" role="status">
        {snapshot
          ? `Snapshot from ${new Date(snapshot.observed_at).toLocaleString()}. Refresh for current status.`
          : busy
            ? "Loading workspace status…"
            : "No status snapshot available."}
      </p>
      {error && (
        <p className="operations-error" role="alert">
          {error} {snapshot && "The previous snapshot is still shown."}
        </p>
      )}
      {snapshot && (
        <>
          {attention.length > 0 && (
            <aside className="operations-attention" aria-label="Needs attention">
              <h2>Needs attention</h2>
              <ul>
                {attention.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
              {(snapshot.queue.interrupted > 0 || snapshot.usage.uncertain_attempts > 0) && (
                <Button className="button secondary" onClick={onOpenRuns}>
                  Open runs
                </Button>
              )}
            </aside>
          )}
          <div className="operations-grid">
            <section className="operations-card" aria-labelledby="operations-workers">
              <h2 id="operations-workers">Workers</h2>
              <dl>
                <Metric label="Connected consumers" value={snapshot.workers.connected_consumers} />
                <Metric label="Parallel command limit" value={snapshot.workers.max_parallel} />
                <Metric label="Reserved slots" value={snapshot.workers.reserved_slots} />
                <Metric label="Pending command limit" value={snapshot.workers.max_pending} />
              </dl>
              <p>
                Each consumer can process one command. Capacity is shared across worker processes.
                Connections show worker presence; an active provider request may still be waiting.
              </p>
            </section>
            <section className="operations-card" aria-labelledby="operations-queue">
              <h2 id="operations-queue">Queue</h2>
              <dl>
                <Metric label="Waiting to start" value={snapshot.queue.queued} />
                <Metric label="Executing" value={snapshot.queue.executing} />
                <Metric label="Awaiting takeover" value={snapshot.queue.awaiting_takeover} />
                <Metric label="Interrupted" value={snapshot.queue.interrupted} />
                <Metric label="Finished in 24 hours" value={snapshot.queue.finished_24h} />
                <Metric
                  label="Oldest pending command"
                  value={age(snapshot.queue.oldest_pending_seconds)}
                />
              </dl>
              <p>
                Finished commands include pauses for human review. Reserved slots can briefly
                include worker polling or configuration.
              </p>
            </section>
            <section className="operations-card" aria-labelledby="operations-storage">
              <h2 id="operations-storage">Stored data</h2>
              <dl>
                <Metric label="Runs" value={snapshot.storage.runs} />
                <Metric label="Evidence records" value={snapshot.storage.evidence_records} />
                <Metric label="Report revisions" value={snapshot.storage.report_revisions} />
                <Metric label="Evaluation datasets" value={snapshot.storage.evaluation_datasets} />
                <Metric label="Stored originals" value={snapshot.storage.originals} />
                <Metric
                  label="Original content size"
                  value={bytes(snapshot.storage.original_bytes)}
                />
                <Metric label="Workspace disk size" value={bytes(snapshot.storage.schema_bytes)} />
              </dl>
              <p>
                Disk size includes tables, indexes and reusable space. Backups and account
                credentials are stored separately. No automatic deletion is configured.
              </p>
            </section>
            <section className="operations-card" aria-labelledby="operations-usage">
              <h2 id="operations-usage">Model usage</h2>
              <p className="operations-window">Attempts started in the last 24 hours</p>
              <dl>
                <Metric label="Attempts started" value={snapshot.usage.attempts_started_24h} />
                <Metric
                  label="Reported input tokens"
                  value={snapshot.usage.reported_input_tokens_24h}
                />
                <Metric
                  label="Reported output tokens"
                  value={snapshot.usage.reported_output_tokens_24h}
                />
                <Metric
                  label="Attempts missing token counts"
                  value={snapshot.usage.incomplete_usage_24h}
                />
                <Metric
                  label="Uncertain attempts, all time"
                  value={snapshot.usage.uncertain_attempts}
                />
              </dl>
              <p>
                Reported totals may be incomplete when counts are missing. Plan allowance and
                billing are managed by your provider.
              </p>
            </section>
          </div>
        </>
      )}
      <RetentionPanel />
    </section>
  );
}
