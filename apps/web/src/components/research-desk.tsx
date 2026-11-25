"use client";

import {
  Activity,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type MouseEventHandler,
} from "react";
import { useOwner } from "./access-context";
import { AccessControls } from "./access-controls";
import { ResearchLauncher } from "./research-launcher";
import {
  ResearchReviewQueue,
  researchDecisionsUrl,
  type DecisionReturnPosition,
} from "./research-review-queue";
import { RunArchive, type ArchiveReturnPosition } from "./run-archive";
import { formatTime, RunStatus } from "./run-status";
import type { EvidenceRecord } from "@/lib/evidence";
import { api, type RecentRunSummary } from "@/lib/workflow";
import { sessionUrl, type ArchivedSourceAppend } from "@/lib/research-sessions";
import { pollVisiblePage } from "@/lib/poll-visible-page";
import styles from "./research-desk.module.css";

const ResearchSession = lazy(() =>
  import("./research-session").then(({ ResearchSession }) => ({ default: ResearchSession })),
);
const ResearchMethodology = lazy(() =>
  import("./research-methodology").then(({ ResearchMethodology }) => ({
    default: ResearchMethodology,
  })),
);
const studiesUrl = "?view=research&studies=1";
const methodologyUrl = "?view=methodology";
const readerTitle = "study-reader-title";
const decisionsTitle = "research-decisions";
const methodologyTitle = "research-methodology-title";
const packetHeading = "packet-heading";

function useRecentStudies(enabled: boolean) {
  const [studies, setStudies] = useState<RecentRunSummary[]>();
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    return pollVisiblePage(async ({ isCurrent, schedule }) => {
      try {
        const items = await api<RecentRunSummary[]>("research-sessions");
        if (!isCurrent()) return;
        setStudies(items);
        setError("");
        if (items.some((item) => ["queued", "running", "paused"].includes(item.status)))
          schedule(5000);
      } catch (cause) {
        if (isCurrent())
          setError(cause instanceof Error ? cause.message : "Could not load recent research.");
      }
    });
  }, [enabled, refresh]);
  return { studies, error, retry: () => setRefresh((n) => n + 1) };
}

function RecentStudies({
  studies,
  error,
  retry,
  onOpenStudy,
}: ReturnType<typeof useRecentStudies> & { onOpenStudy: MouseEventHandler<HTMLAnchorElement> }) {
  return (
    <section
      className={styles.history}
      aria-labelledby="recent-studies"
      id="research-history"
      tabIndex={-1}
    >
      <h2 id="recent-studies">Recent research</h2>
      {error && (
        <div className={styles.notice} role="alert">
          <span>{error}</span>
          <button type="button" className="text-link" onClick={retry}>
            Retry history
          </button>
        </div>
      )}
      {studies?.length ? (
        <ul className={styles.historyRows}>
          {studies.map((study) => (
            <li key={study.id}>
              <a href={sessionUrl(study.id)} onClick={onOpenStudy}>
                <span className={styles.studyTitle}>
                  {study.study_title || study.brief_excerpt || study.workflow_name}
                </span>
                <RunStatus status={study.status} />
                <time dateTime={study.created_at}>{formatTime(study.created_at)}</time>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        !error && (
          <p className={styles.empty} role="status">
            {studies ? "Your first study will appear here once it starts." : "Loading research…"}
          </p>
        )
      )}
      {!!studies?.length && <RunArchive sessionsOnly onOpenLink={onOpenStudy} />}
    </section>
  );
}

export function ResearchDesk({
  session,
  fromSession,
  methodology,
  decisions,
  studies,
  onNavigate,
}: {
  session: string | null;
  fromSession: string | null;
  methodology: boolean;
  decisions: boolean;
  studies: boolean;
  onNavigate: (href: string) => void;
}) {
  const { active } = useOwner();
  const deskView = session
    ? "session"
    : methodology
      ? "methodology"
      : decisions
        ? "decisions"
        : studies
          ? "studies"
          : "launch";
  const showingDraft = deskView === "launch";
  const recent = useRecentStudies(active && showingDraft);
  const [draftScope, setDraftScope] = useState<string | null | undefined>(() =>
    showingDraft ? fromSession : undefined,
  );
  const [sourceAppend, setSourceAppend] = useState<ArchivedSourceAppend>();
  if (showingDraft && draftScope !== fromSession) setDraftScope(fromSession);
  if (sourceAppend && (!showingDraft || sourceAppend.scope !== fromSession))
    setSourceAppend(undefined);
  const readingWithDraft = deskView === "session" && draftScope !== undefined;
  const learningWithDraft = deskView === "methodology" && draftScope !== undefined;
  const showingDecisions = deskView === "decisions";
  const returningToDraft =
    deskView === "studies" || showingDecisions || readingWithDraft || learningWithDraft;
  const [visitedDecisions, setVisitedDecisions] = useState(showingDecisions);
  if (showingDecisions && !visitedDecisions) setVisitedDecisions(true);
  const focusAfterNavigation = useRef<string>(null);
  const previousView = useRef(deskView);
  const previousDecision = useRef(false);
  const archivePosition = useRef<ArchiveReturnPosition | undefined>(undefined);
  const decisionPosition = useRef<DecisionReturnPosition | undefined>(undefined);
  const previousReader = useRef<string | null>(null);
  const returnToDraft = draftScope
    ? `?fromSession=${encodeURIComponent(draftScope)}`
    : "?view=research";

  useLayoutEffect(() => {
    if (deskView === "session") previousReader.current = session;
    else if (deskView !== "studies") previousReader.current = null;
    const from = previousView.current;
    const fromDecision = previousDecision.current;
    previousView.current = deskView;
    previousDecision.current =
      deskView === "session" &&
      /^(#source-led-investigation$|#editorial-review$|#consultation-)/u.test(window.location.hash);
    if (
      deskView !== "decisions" &&
      (deskView !== "session" || decisionPosition.current?.studyId !== session)
    )
      decisionPosition.current = undefined;
    const requested = focusAfterNavigation.current;
    if (
      (requested === readerTitle && deskView !== "session") ||
      (requested === methodologyTitle && deskView !== "methodology")
    )
      focusAfterNavigation.current = null;
    let id = focusAfterNavigation.current;
    if (!id && deskView !== from) {
      if (deskView === "decisions") id = decisionsTitle;
      if (deskView === "methodology") id = methodologyTitle;
      if (deskView === "launch" && (from === "decisions" || from === "methodology" || fromDecision))
        id = "research-title";
    }
    if (!id) return;
    const target = document.getElementById(id);
    if (id === readerTitle || (id === methodologyTitle && !target)) {
      focusAfterNavigation.current = id;
      window.scrollTo(0, 0);
      return;
    }
    focusAfterNavigation.current = null;
    if (id === packetHeading) {
      (target ?? document.getElementById("research-title"))?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "start" });
      return;
    }
    target?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [deskView, session]);

  const focusReaderTitle = useCallback((title: HTMLHeadingElement | null) => {
    if (!title || focusAfterNavigation.current !== readerTitle) return;
    focusAfterNavigation.current = null;
    title.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, []);

  const focusMethodologyTitle = useCallback((title: HTMLHeadingElement | null) => {
    if (!title || focusAfterNavigation.current !== methodologyTitle) return;
    focusAfterNavigation.current = null;
    title.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, []);

  const getArchiveReturnPosition = useCallback(() => {
    const focused = document.activeElement;
    if (focused && focused !== document.body && focused.id !== "studies-title") return;
    const position = archivePosition.current;
    return position?.studyId === previousReader.current ? position : undefined;
  }, []);

  const takeDecisionReturnPosition = useCallback(() => {
    const position = decisionPosition.current;
    decisionPosition.current = undefined;
    const focused = document.activeElement;
    if (focused === document.body || focused?.id === decisionsTitle) return position;
  }, []);

  function navigateWithinDesk(
    event: MouseEvent<HTMLAnchorElement>,
    heading?: string,
    archiveStudy?: Omit<ArchiveReturnPosition, "top">,
  ) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return false;
    event.preventDefault();
    const { href } = event.currentTarget;
    if (href === window.location.href) return false;
    if (archiveStudy)
      archivePosition.current = {
        ...archiveStudy,
        top: event.currentTarget.getBoundingClientRect().top,
      };
    focusAfterNavigation.current = heading ?? null;
    onNavigate(href);
    return true;
  }

  function openQueuedDecision(
    event: MouseEvent<HTMLAnchorElement>,
    row?: Omit<DecisionReturnPosition, "top">,
  ) {
    const top = event.currentTarget.getBoundingClientRect().top;
    if (navigateWithinDesk(event) && row) decisionPosition.current = { ...row, top };
  }

  function appendArchivedSource(source: EvidenceRecord) {
    if (!active || !readingWithDraft || draftScope === undefined) return;
    setSourceAppend({ scope: draftScope, source });
    focusAfterNavigation.current = packetHeading;
    onNavigate(`${returnToDraft}#${packetHeading}`);
  }

  return (
    <div className={styles.desk}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a
            className={styles.homeLink}
            href={returningToDraft ? returnToDraft : "?view=research"}
            aria-current={deskView === "launch" && !fromSession ? "page" : undefined}
            onClick={
              returningToDraft ? (event) => navigateWithinDesk(event, "research-title") : undefined
            }
          >
            Research desk
          </a>
          <nav aria-label="Research navigation">
            <a
              href={studiesUrl}
              aria-current={deskView === "studies" ? "page" : undefined}
              onClick={(event) => {
                if (
                  showingDraft ||
                  returningToDraft ||
                  archivePosition.current?.studyId === session
                )
                  navigateWithinDesk(event, "studies-title");
              }}
            >
              Studies
            </a>
            <a
              href={researchDecisionsUrl}
              aria-current={deskView === "decisions" ? "page" : undefined}
              onClick={(event) => {
                if (
                  showingDraft ||
                  returningToDraft ||
                  decisionPosition.current?.studyId === session
                )
                  navigateWithinDesk(event, decisionsTitle);
              }}
            >
              Decisions
            </a>
            <a
              href={methodologyUrl}
              aria-current={deskView === "methodology" ? "page" : undefined}
              onClick={
                draftScope !== undefined
                  ? (event) => navigateWithinDesk(event, methodologyTitle)
                  : undefined
              }
            >
              Methodology
            </a>
            <a href="?view=workflow">Workflows</a>
            <a href="?view=evidence">Sources</a>
            <a href="?view=reports">Reports</a>
          </nav>
          <AccessControls key={active ? "active" : "locked"} />
        </div>
      </header>
      {draftScope !== undefined && (
        <main className={styles.page} hidden={!showingDraft}>
          {showingDraft && !draftScope && (
            <ResearchReviewQueue
              summary
              onOpenDecision={(event) => navigateWithinDesk(event)}
              onViewQueue={(event) => navigateWithinDesk(event, decisionsTitle)}
            />
          )}
          <Activity mode={showingDraft ? "visible" : "hidden"}>
            <ResearchLauncher
              key={draftScope ?? "new"}
              fromSession={draftScope}
              recentStudies={recent.studies}
              sourceAppend={sourceAppend?.scope === draftScope ? sourceAppend : undefined}
              onSourceAppendHandled={(handled) =>
                setSourceAppend((current) => (current === handled ? undefined : current))
              }
            />
          </Activity>
          {showingDraft && (
            <RecentStudies
              {...recent}
              onOpenStudy={(event) => navigateWithinDesk(event, readerTitle)}
            />
          )}
        </main>
      )}
      {visitedDecisions && (
        <main className={styles.page} hidden={!showingDecisions}>
          <ResearchReviewQueue
            visible={showingDecisions}
            onOpenDecision={openQueuedDecision}
            takeReturnPosition={takeDecisionReturnPosition}
            headingAction={
              draftScope !== undefined && (
                <a
                  className="button"
                  href={returnToDraft}
                  onClick={(event) => navigateWithinDesk(event, "research-title")}
                >
                  Return to study setup
                </a>
              )
            }
          />
        </main>
      )}
      {session ? (
        <Suspense
          fallback={
            <main className={styles.page}>
              <h1>Research session</h1>
              <p role="status">Opening the research session…</p>
            </main>
          }
        >
          <ResearchSession
            runId={session}
            titleRef={focusReaderTitle}
            openComparisonInNewTab={readingWithDraft}
            onReuseSource={active && readingWithDraft ? appendArchivedSource : undefined}
            onNewStudy={(source) => {
              window.location.assign(
                source ? `?fromSession=${encodeURIComponent(source)}` : "?view=research",
              );
            }}
          />
        </Suspense>
      ) : deskView === "methodology" ? (
        <Suspense
          fallback={
            <main className={styles.page}>
              <h1>Methodology</h1>
              <p role="status">Opening the research methodology…</p>
            </main>
          }
        >
          <ResearchMethodology
            titleRef={focusMethodologyTitle}
            setupHref={learningWithDraft ? returnToDraft : undefined}
            onReturn={
              learningWithDraft ? (event) => navigateWithinDesk(event, "research-title") : undefined
            }
          />
        </Suspense>
      ) : deskView === "studies" ? (
        <main className={styles.page}>
          <section className={styles.studies} aria-labelledby="studies-title">
            <div className={styles.studiesHeading}>
              <h1 id="studies-title" tabIndex={-1}>
                Studies
              </h1>
              <a
                className="button"
                href={returnToDraft}
                onClick={(event) => navigateWithinDesk(event, "research-title")}
              >
                {draftScope !== undefined ? "Return to study setup" : "New study"}
              </a>
            </div>
            <RunArchive
              sessionsOnly
              expanded
              onOpenLink={(event, study) => navigateWithinDesk(event, readerTitle, study)}
              getReturnPosition={getArchiveReturnPosition}
            />
          </section>
        </main>
      ) : null}
    </div>
  );
}
