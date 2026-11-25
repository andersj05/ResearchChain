"use client";

import {
  Activity,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { useOwner } from "./access-context";
import { AccessControls } from "./access-controls";
import { ResearchLauncher } from "./research-launcher";
import { ResearchReviewQueue, researchDecisionsUrl } from "./research-review-queue";
import { RunArchive } from "./run-archive";
import { formatTime, RunStatus } from "./run-status";
import { api, type RecentRunSummary } from "@/lib/workflow";
import { sessionUrl } from "@/lib/research-sessions";
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

function RecentStudies() {
  const { active } = useOwner();
  const [studies, setStudies] = useState<RecentRunSummary[]>();
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!active) return;
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
  }, [active, refresh]);
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
          <button type="button" className="text-link" onClick={() => setRefresh((n) => n + 1)}>
            Retry history
          </button>
        </div>
      )}
      {studies?.length ? (
        <ul className={styles.historyRows}>
          {studies.map((study) => (
            <li key={study.id}>
              <a href={sessionUrl(study.id)}>
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
      {!!studies?.length && <RunArchive sessionsOnly />}
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
  const [draftScope, setDraftScope] = useState<string | null | undefined>(() =>
    showingDraft ? fromSession : undefined,
  );
  if (showingDraft && draftScope !== fromSession) setDraftScope(fromSession);
  const focusAfterNavigation = useRef<string>(null);
  const returnToDraft = draftScope
    ? `?fromSession=${encodeURIComponent(draftScope)}`
    : "?view=research";

  useLayoutEffect(() => {
    const id = focusAfterNavigation.current;
    if (!id) return;
    focusAfterNavigation.current = null;
    document.getElementById(id)?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [deskView]);

  function navigateWithinDesk(event: MouseEvent<HTMLAnchorElement>, heading: string) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    const { href } = event.currentTarget;
    if (href === window.location.href) return;
    focusAfterNavigation.current = heading;
    onNavigate(href);
  }

  return (
    <div className={styles.desk}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a
            className={styles.homeLink}
            href={deskView === "studies" ? returnToDraft : "?view=research"}
            aria-current={deskView === "launch" && !fromSession ? "page" : undefined}
            onClick={
              deskView === "studies"
                ? (event) => navigateWithinDesk(event, "research-title")
                : undefined
            }
          >
            Research desk
          </a>
          <nav aria-label="Research navigation">
            <a
              href={studiesUrl}
              aria-current={deskView === "studies" ? "page" : undefined}
              onClick={
                showingDraft || deskView === "studies"
                  ? (event) => navigateWithinDesk(event, "studies-title")
                  : undefined
              }
            >
              Studies
            </a>
            <a
              href={researchDecisionsUrl}
              aria-current={deskView === "decisions" ? "page" : undefined}
            >
              Decisions
            </a>
            <a
              href="?view=methodology"
              aria-current={deskView === "methodology" ? "page" : undefined}
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
          {showingDraft && !draftScope && <ResearchReviewQueue summary />}
          <Activity mode={showingDraft ? "visible" : "hidden"}>
            <ResearchLauncher key={draftScope ?? "new"} fromSession={draftScope} />
          </Activity>
          {showingDraft && <RecentStudies />}
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
          <ResearchMethodology />
        </Suspense>
      ) : deskView === "decisions" ? (
        <main className={styles.page}>
          <ResearchReviewQueue />
        </main>
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
            <RunArchive sessionsOnly expanded />
          </section>
        </main>
      ) : null}
    </div>
  );
}
