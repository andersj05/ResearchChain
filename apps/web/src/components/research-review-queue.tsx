import {
  useEffect,
  useLayoutEffect,
  useState,
  type MouseEvent,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { useOwner } from "./access-context";
import { formatTime } from "./run-status";
import { sessionUrl } from "@/lib/research-sessions";
import { pollVisiblePage } from "@/lib/poll-visible-page";
import { api, type PendingReviewsPage } from "@/lib/workflow";
import styles from "./research-desk.module.css";

type Study = PendingReviewsPage["items"][number];
type Review = Study["reviews"][number];
type DecisionRow = {
  studyId: string;
  interruptId: string;
  studyIndex: number;
  reviewIndex: number;
  offset: number;
};
export type DecisionReturnPosition = DecisionRow & { top: number };
type QueueLinks = {
  onOpenDecision?: (event: MouseEvent<HTMLAnchorElement>, row?: DecisionRow) => void;
  onViewQueue?: MouseEventHandler<HTMLAnchorElement>;
};

export const researchDecisionsUrl = "/?view=research&inbox=1";
const pageSize = 20;

function decisionId(study: Study, review: Review) {
  return `pending-${study.id}-${review.interrupt_id}`;
}

function decisionLink(study: Study, review: Review) {
  if (review.perspective)
    return {
      href: `${sessionUrl(study.id)}#consultation-${encodeURIComponent(review.interrupt_id)}`,
      label: `Answer ${review.perspective.lead_title}`,
    };
  if (review.node_id === "working_sentence")
    return {
      href: `${sessionUrl(study.id)}#source-led-investigation`,
      label: "Choose a working sentence",
    };
  return { href: `${sessionUrl(study.id)}#editorial-review`, label: "Review editorial direction" };
}

function ReviewPage({
  summary,
  offset,
  changePage,
  onOpenDecision,
  onViewQueue,
  takeReturnPosition,
}: {
  summary: boolean;
  offset: number;
  changePage: (offset: number) => void;
  takeReturnPosition?: () => DecisionReturnPosition | undefined;
} & QueueLinks) {
  const { active } = useOwner();
  const [page, setPage] = useState<PendingReviewsPage>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!active) return;
    const path = `runs/reviews?sessions_only=true&limit=${summary ? 1 : pageSize}&offset=${offset}`;
    return pollVisiblePage(async ({ isCurrent, schedule }) => {
      try {
        const next = await api<PendingReviewsPage>(path);
        if (!isCurrent()) return;
        if (offset && !next.items.length) {
          changePage(offset - pageSize);
          return;
        }
        setPage(next);
        setError(false);
      } catch {
        if (isCurrent()) setError(true);
      } finally {
        schedule(15000);
      }
    });
  }, [active, changePage, offset, retry, summary]);

  useLayoutEffect(() => {
    if (!page || error) return;
    const position = takeReturnPosition?.();
    if (!position) return;
    const adjacentIndex = position.offset > offset ? page.items.length - 1 : position.studyIndex;
    const study =
      page.items.find(({ id }) => id === position.studyId) ??
      page.items[Math.min(adjacentIndex, page.items.length - 1)];
    const review =
      study?.reviews.find(({ interrupt_id }) => interrupt_id === position.interruptId) ??
      study?.reviews[Math.min(position.reviewIndex, study.reviews.length - 1)];
    if (!study || !review) return;
    const target = document.getElementById(decisionId(study, review));
    if (!target) return;
    target.focus({ preventScroll: true });
    const rect = target.getBoundingClientRect();
    const top = Math.max(0, Math.min(position.top, window.innerHeight - rect.height));
    window.scrollBy(0, rect.top - top);
  }, [error, offset, page, takeReturnPosition]);

  if (summary) {
    const study = !error ? page?.items[0] : undefined;
    const review = study?.reviews[0];
    if (!study || !review) return null;
    const { href, label } = decisionLink(study, review);
    return (
      <aside className={styles.decisionSummary} aria-label="Pending study decisions">
        <div>
          <strong>Waiting for your input</strong>
          <a href={href} onClick={onOpenDecision}>
            {study.study_title || study.brief_excerpt || study.workflow_name}
          </a>
          <span>{label}</span>
        </div>
        <a href={researchDecisionsUrl} onClick={onViewQueue}>
          View decision queue
        </a>
      </aside>
    );
  }

  return (
    <>
      {error ? (
        <div role="alert" className={styles.notice}>
          <span>Could not load the decision queue.</span>
          <button
            type="button"
            className="text-link"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      ) : !page ? (
        <p role="status">Loading decisions…</p>
      ) : !page.items.length ? (
        <p role="status" className={styles.empty}>
          {offset ? "No studies on this page." : "No research studies are waiting for a decision."}
        </p>
      ) : (
        <ul className={styles.decisionRows} aria-label="Studies waiting for a decision">
          {page.items.map((study, studyIndex) => (
            <li key={study.id}>
              <h2>{study.study_title || study.brief_excerpt || study.workflow_name}</h2>
              <time dateTime={study.created_at}>{formatTime(study.created_at, true)}</time>
              <ul aria-label="Open decisions">
                {study.reviews.map((review, reviewIndex) => {
                  const { href, label } = decisionLink(study, review);
                  return (
                    <li key={review.interrupt_id}>
                      <p>{review.question}</p>
                      <a
                        id={decisionId(study, review)}
                        href={href}
                        onClick={(event) =>
                          onOpenDecision?.(event, {
                            studyId: study.id,
                            interruptId: review.interrupt_id,
                            studyIndex,
                            reviewIndex,
                            offset,
                          })
                        }
                      >
                        {label}
                      </a>
                    </li>
                  );
                })}
              </ul>
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
            disabled={error || !page?.has_more}
            onClick={() => changePage(offset + pageSize)}
          >
            Next page
          </button>
        </div>
      )}
    </>
  );
}

export function ResearchReviewQueue({
  summary = false,
  visible = true,
  headingAction,
  takeReturnPosition,
  ...links
}: QueueLinks & {
  summary?: boolean;
  visible?: boolean;
  headingAction?: ReactNode;
  takeReturnPosition?: () => DecisionReturnPosition | undefined;
}) {
  const [offset, setOffset] = useState(0);
  // A return uses a fresh queue read so an admitted answer cannot restore an obsolete row.
  const page = visible ? (
    <ReviewPage
      key={offset}
      offset={offset}
      changePage={setOffset}
      summary={summary}
      takeReturnPosition={takeReturnPosition}
      {...links}
    />
  ) : null;
  if (summary) return page;
  return (
    <section className={styles.decisions} aria-labelledby="research-decisions">
      <div className={styles.studiesHeading}>
        <h1 id="research-decisions" tabIndex={-1}>
          Study decisions
        </h1>
        {headingAction}
      </div>
      <p className={styles.intro}>
        Working sentences, questions from research leads, and editorial decisions. Oldest studies
        appear first.
      </p>
      {page}
    </section>
  );
}
