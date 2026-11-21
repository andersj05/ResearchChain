import { useEffect, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { formatTime } from "@/components/run-status";
import { api, type PendingReviewsPage } from "@/lib/workflow";

export type ReviewTarget = { runId: string; checkpointId: string; interruptId: string };

const pageSize = 20;

function InboxPage({
  offset,
  agentId,
  busy,
  onOpen,
  changePage,
}: {
  offset: number;
  agentId?: string;
  busy: boolean;
  onOpen: (target: ReviewTarget) => Promise<boolean>;
  changePage: (offset: number) => void;
}) {
  const [page, setPage] = useState<PendingReviewsPage>();
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (agentId) params.set("agent_id", agentId);
    async function load() {
      try {
        const result = await api<PendingReviewsPage>(`runs/reviews?${params}`);
        if (active) {
          setPage(result);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      } finally {
        if (active) timer = setTimeout(load, 10_000);
      }
    }
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [agentId, offset, refresh]);

  return (
    <div className="review-inbox-content">
      <div className="review-inbox-toolbar">
        <span className="muted">Oldest runs first</span>
        <button className="button small" type="button" onClick={() => setRefresh(refresh + 1)}>
          Refresh inbox
        </button>
      </div>
      {error ? (
        <p role="alert">Could not refresh the review inbox.</p>
      ) : !page ? (
        <p role="status">Loading reviews…</p>
      ) : !page.items.length ? (
        <p className="muted">{offset ? "No reviews on this page." : "No runs need a decision."}</p>
      ) : (
        <ul>
          {page.items.map((item) => (
            <li key={item.id}>
              <strong>{item.workflow_name}</strong>
              <p className="run-row-meta">
                {item.agent_name !== item.workflow_name && (
                  <span>{item.agent_name ?? "Unassigned"}</span>
                )}
                <time dateTime={item.created_at}>{formatTime(item.created_at)}</time>
              </p>
              {item.brief_excerpt?.trim() && (
                <p className="run-row-brief" id={`inbox-brief-${item.id}`}>
                  {item.brief_excerpt}
                </p>
              )}
              {item.reviews.map((review) => {
                const questionId = `inbox-${item.id}-${review.interrupt_id}`;
                return (
                  <div className="review-inbox-question" key={review.interrupt_id}>
                    <p id={questionId}>{review.question}</p>
                    {review.perspective && (
                      <small>{review.perspective.lead_title} requests your perspective</small>
                    )}
                    {review.path && review.path.split("/").length > 2 && (
                      <small className="muted">{review.path.replaceAll("/", " › ")}</small>
                    )}
                    <Button
                      className="button small"
                      aria-describedby={
                        item.brief_excerpt?.trim()
                          ? `${questionId} inbox-brief-${item.id}`
                          : questionId
                      }
                      disabled={busy}
                      onClick={async () => {
                        const opened = await onOpen({
                          runId: item.id,
                          checkpointId: item.checkpoint_id,
                          interruptId: review.interrupt_id,
                        });
                        if (!opened) setRefresh((value) => value + 1);
                      }}
                    >
                      Open review
                    </Button>
                  </div>
                );
              })}
            </li>
          ))}
        </ul>
      )}
      {(offset > 0 || page?.has_more) && (
        <div className="actions">
          <button
            type="button"
            className="button small"
            disabled={offset === 0}
            onClick={() => changePage(offset - pageSize)}
          >
            Previous page
          </button>
          <button
            type="button"
            className="button small"
            disabled={!page?.has_more || error}
            onClick={() => changePage(offset + pageSize)}
          >
            Next page
          </button>
        </div>
      )}
    </div>
  );
}

export function ReviewInbox({
  activeAgentId,
  activeAgentName,
  busy,
  onOpen,
}: {
  activeAgentId?: string;
  activeAgentName?: string;
  busy: boolean;
  onOpen: (target: ReviewTarget) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [scope, setScope] = useState("all");
  const agentId = scope === "agent" ? activeAgentId : undefined;
  return (
    <details
      className="review-inbox"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Review inbox</summary>
      {open && (
        <>
          {activeAgentId && (
            <label className="review-inbox-scope">
              Show reviews for
              <select
                value={agentId ? "agent" : "all"}
                onChange={(event) => {
                  setScope(event.target.value);
                  setOffset(0);
                }}
              >
                <option value="all">All agents</option>
                <option value="agent">{activeAgentName ?? "Current agent"}</option>
              </select>
            </label>
          )}
          <InboxPage
            key={`${agentId ?? "all"}:${offset}`}
            offset={offset}
            agentId={agentId}
            busy={busy}
            changePage={setOffset}
            onOpen={async (target) => {
              const opened = await onOpen(target);
              if (opened) setOpen(false);
              return opened;
            }}
          />
        </>
      )}
    </details>
  );
}
