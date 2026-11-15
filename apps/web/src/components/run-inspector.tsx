"use client";

import { useState } from "react";
import { ResearchResults } from "@/components/research-results";
import { PinnedEvidence } from "@/components/pinned-evidence";
import { Button } from "@ui-sdk/react/button";
import type { RunSnapshot, RunSummary } from "@/lib/workflow";
import { RotateCw, Check, X } from "lucide-react";

export function RunStatus({ status }: { status: RunSummary["status"] }) {
  const label = {
    queued: "Queued",
    paused: "Needs review",
    running: "Running",
    completed: "Completed",
    rejected: "Rejected",
    interrupted: "Needs recovery",
    cancelled: "Cancelled",
    limited: "Limit reached",
    failed: "Needs attention",
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
  onCancel,
  onOpenRevision,
}: {
  run: RunSnapshot | null;
  busy: boolean;
  onResume: (
    decision: "approve" | "reject",
    interruptId?: string,
    feedback?: string,
  ) => Promise<void>;
  onRecover: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onCancel: () => Promise<void>;
  onOpenRevision: () => Promise<void>;
}) {
  const [feedback, setFeedback] = useState<Record<string, string>>({});
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
            <div className="actions run-actions">
              {(run.status === "paused" ||
                run.status === "queued" ||
                run.status === "interrupted" ||
                run.status === "running") && (
                <Button className="button" onClick={onCancel}>
                  Cancel run
                </Button>
              )}
              <Button className="button small" disabled={busy} onClick={onRefresh}>
                <RotateCw size={14} aria-hidden="true" />
                Refresh run
              </Button>
            </div>
          </div>
          {run.status === "queued" && (
            <div className="review-box" role="status">
              <h3>Waiting to start</h3>
              <p>
                Your run is saved and will start when capacity is available. You can leave this page
                and return later.
              </p>
            </div>
          )}
          {run.stop_reason && (
            <p className="review-box" role="status">
              {run.stop_reason}
            </p>
          )}
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
          <ResearchResults run={run} />
          {run.status === "paused" &&
            (run.reviews?.length ? run.reviews : run.review ? [run.review] : []).map((review) => (
              <div
                className="review-box"
                key={review.interrupt_id}
                aria-label={`Review ${review.node_id}`}
              >
                <p className="eyebrow">Human review</p>
                <h3>{review.question}</h3>
                {review.path && <p className="muted">{review.path.replaceAll("/", " › ")}</p>}
                <p>This decision applies to this checkpoint of revision {run.revision_number}.</p>
                {run.workflow.schema_version === "0.3" && (
                  <label>
                    Reviewer feedback
                    <textarea
                      rows={3}
                      maxLength={6000}
                      disabled={busy}
                      value={feedback[review.interrupt_id] ?? ""}
                      onChange={(event) =>
                        setFeedback({ ...feedback, [review.interrupt_id]: event.target.value })
                      }
                      placeholder="What should the next step challenge or revise?"
                    />
                  </label>
                )}
                <div className="actions">
                  <Button
                    className="button primary"
                    disabled={busy}
                    onClick={() =>
                      onResume("approve", review.interrupt_id, feedback[review.interrupt_id] ?? "")
                    }
                  >
                    <Check size={16} aria-hidden="true" /> Approve and continue
                  </Button>
                  <Button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      onResume("reject", review.interrupt_id, feedback[review.interrupt_id] ?? "")
                    }
                  >
                    <X size={16} aria-hidden="true" /> Reject and stop
                  </Button>
                </div>
              </div>
            ))}
          <PinnedEvidence key={run.id} ids={run.evidence_ids ?? []} />
          <h3 className="steps-heading">
            Completed steps <span className="count">{run.events.length}</span>
          </h3>
          {run.events.length ? (
            <ol className="event-list">
              {run.events.map((event) => (
                <li key={event.path ?? event.node_id}>
                  <strong>{event.label}</strong>
                  <span>{event.detail}</span>
                  {event.path && event.path.split("/").length > 2 && (
                    <small className="muted">{event.path.replaceAll("/", " › ")}</small>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">No completed steps yet.</p>
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
              <dt>Executed steps</dt>
              <dd>{run.usage?.node_executions ?? run.events.length}</dd>
              <dt>Active time</dt>
              <dd>{(run.usage?.active_seconds ?? 0).toFixed(2)} seconds</dd>
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
          <h2>No run selected</h2>
          <p>Run a workflow or open a recent run to inspect its progress.</p>
        </div>
      )}
    </section>
  );
}
