import { type Ref, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { formatTime } from "@/components/run-status";
import { api, type PendingReviewsPage } from "@/lib/workflow";

type ReviewTarget = { runId: string; checkpointId: string; interruptId: string };
type ReviewScope = "all" | "agent";
export type ReviewInboxOrigin = {
  target: ReviewTarget;
  index: number;
  offset: number;
  scope: ReviewScope;
};
export type ReviewInboxHandle = { restore: (origin: ReviewInboxOrigin) => void };

const pageSize = 20;

function reviewKey({ runId, checkpointId, interruptId }: ReviewTarget) {
  return `${runId}:${checkpointId}:${interruptId}`;
}

function reviewButtons(container: HTMLDivElement | null) {
  return Array.from(
    container?.querySelectorAll<HTMLButtonElement>("button[data-inbox-review]") ?? [],
  );
}

function InboxPage({
  offset,
  agentId,
  busy,
  returnTo,
  onReturnRestored,
  onOpen,
  changePage,
}: {
  offset: number;
  agentId?: string;
  busy: boolean;
  returnTo?: ReviewInboxOrigin;
  onReturnRestored: () => void;
  onOpen: (target: ReviewTarget, index: number) => Promise<boolean>;
  changePage: (offset: number) => void;
}) {
  const [page, setPage] = useState<PendingReviewsPage>();
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const content = useRef<HTMLDivElement>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const previousPage = useRef<HTMLButtonElement>(null);

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

  useLayoutEffect(() => {
    if (!returnTo || busy || (!page && !error)) return;
    const buttons = reviewButtons(content.current);
    const key = reviewKey(returnTo.target);
    const button =
      buttons.find((candidate) => candidate.dataset.inboxReview === key) ??
      buttons[Math.min(returnTo.index, buttons.length - 1)] ??
      (!error && offset > 0 ? previousPage.current : refreshButton.current);
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: "center" });
    onReturnRestored();
  }, [busy, error, offset, onReturnRestored, page, returnTo]);

  return (
    <div className="review-inbox-content" ref={content}>
      <div className="review-inbox-toolbar">
        <span className="muted">Oldest runs first</span>
        <button
          className="button small"
          type="button"
          ref={refreshButton}
          onClick={() => setRefresh(refresh + 1)}
        >
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
                const target = {
                  runId: item.id,
                  checkpointId: item.checkpoint_id,
                  interruptId: review.interrupt_id,
                };
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
                      data-inbox-review={reviewKey(target)}
                      aria-describedby={
                        item.brief_excerpt?.trim()
                          ? `${questionId} inbox-brief-${item.id}`
                          : questionId
                      }
                      disabled={busy}
                      onClick={async (event) => {
                        const index = reviewButtons(content.current).findIndex(
                          (button) => button === event.currentTarget,
                        );
                        const opened = await onOpen(target, index);
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
            ref={previousPage}
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
  ref,
  onOpen,
}: {
  activeAgentId?: string;
  activeAgentName?: string;
  busy: boolean;
  ref?: Ref<ReviewInboxHandle>;
  onOpen: (origin: ReviewInboxOrigin) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [scope, setScope] = useState<ReviewScope>("all");
  const [returnTo, setReturnTo] = useState<ReviewInboxOrigin>();
  const agentId = scope === "agent" ? activeAgentId : undefined;
  useImperativeHandle(
    ref,
    () => ({
      restore(origin) {
        setScope(origin.scope);
        setOffset(origin.offset);
        setReturnTo(origin);
        setOpen(true);
      },
    }),
    [],
  );
  return (
    <details
      className="review-inbox"
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (!event.currentTarget.open) setReturnTo(undefined);
      }}
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
                  setScope(event.target.value === "agent" ? "agent" : "all");
                  setOffset(0);
                  setReturnTo(undefined);
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
            returnTo={returnTo}
            onReturnRestored={() => setReturnTo(undefined)}
            changePage={(nextOffset) => {
              setOffset(nextOffset);
              setReturnTo(undefined);
            }}
            onOpen={async (target, index) => {
              const opened = await onOpen({ target, index, offset, scope });
              if (opened) setOpen(false);
              return opened;
            }}
          />
        </>
      )}
    </details>
  );
}
