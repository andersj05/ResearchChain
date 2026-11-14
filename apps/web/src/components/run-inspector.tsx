"use client";

import { Button } from "@ui-sdk/react/button";
import type { RunSnapshot, RunSummary } from "@/lib/workflow";

export function RunStatus({ status }: { status: RunSummary["status"] }) {
  const label = {
    paused: "Needs review",
    completed: "Completed",
    rejected: "Rejected",
    interrupted: "Needs recovery",
  }[status];
  return (
    <span className={`run-status status-${status}`}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}

export function formatTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function RunInspector({
  run,
  busy,
  onResume,
  onRecover,
  onRefresh,
  onOpenRevision,
}: {
  run: RunSnapshot | null;
  busy: boolean;
  onResume: (decision: "approve" | "reject") => Promise<void>;
  onRecover: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onOpenRevision: () => Promise<void>;
}) {
  return (
    <section className="run-inspector" aria-label="Run inspector">
      {run ? (
        <>
          <div className="section-heading">
            <div>
              <p className="eyebrow">{run.workflow_name}</p>
              <h2>Run {run.status}</h2>
            </div>
            <RunStatus status={run.status} />
          </div>
          <div className="run-meta">
            <span className="code-label">{run.id.slice(0, 8)}</span>
            <span>Revision {run.revision_number}</span>
            <time dateTime={run.created_at}>{formatTime(run.created_at)}</time>
            <Button className="button small" disabled={busy} onClick={onRefresh}>
              Refresh run
            </Button>
          </div>
          <div className="run-brief">
            <h3>Research brief</h3>
            <p>{run.brief}</p>
          </div>
          {run.status === "interrupted" && (
            <div className="review-box">
              <h3>Continue from saved progress</h3>
              <p>
                The last request did not finish. Recovery continues accepted work and stops at the
                next review.
              </p>
              <Button className="button primary" disabled={busy} onClick={onRecover}>
                Recover run
              </Button>
            </div>
          )}
          <h3 className="steps-heading">
            Completed steps <span className="count">{run.events.length}</span>
          </h3>
          {run.events.length ? (
            <ol className="event-list">
              {run.events.map((event) => (
                <li key={event.node_id}>
                  <strong>{event.label}</strong>
                  <span>{event.detail}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">No completed steps yet.</p>
          )}
          {run.status === "paused" && run.review && (
            <div className="review-box">
              <p className="eyebrow">Human review</p>
              <h3>{run.review.question}</h3>
              <p>This decision applies to this checkpoint of revision {run.revision_number}.</p>
              <div className="actions">
                <Button
                  className="button primary"
                  disabled={busy}
                  onClick={() => onResume("approve")}
                >
                  Approve and continue
                </Button>
                <Button className="button" disabled={busy} onClick={() => onResume("reject")}>
                  Reject and stop
                </Button>
              </div>
            </div>
          )}
          <details className="run-details">
            <summary>Pinned workflow &amp; run details</summary>
            <p className="muted">
              Editor changes apply to future runs. This run keeps revision {run.revision_number}.
            </p>
            <Button className="button" disabled={busy} onClick={onOpenRevision}>
              Open this revision
            </Button>
            <dl>
              <dt>Run ID</dt>
              <dd>{run.id}</dd>
              <dt>Checkpoint</dt>
              <dd>{run.checkpoint_id ?? "Not started"}</dd>
              <dt>Executor</dt>
              <dd>{run.compiler_version}</dd>
              <dt>Artifact references</dt>
              <dd>{run.artifacts.length}</dd>
            </dl>
            <ol className="event-list">
              {run.workflow.nodes.map((node) => (
                <li key={node.id}>
                  <strong>{node.label}</strong>
                  <span>{node.instructions || node.kind}</span>
                </li>
              ))}
            </ol>
          </details>
        </>
      ) : (
        <div className="empty-state">
          <div className="empty-icon" aria-hidden="true">
            ◇
          </div>
          <h2>No run selected</h2>
          <p>Run a workflow or open a recent run to inspect its progress.</p>
        </div>
      )}
    </section>
  );
}
