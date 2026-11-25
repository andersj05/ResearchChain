"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { useOwner } from "./access-context";
import { AccessControls } from "./access-controls";
import { ResearchLauncher } from "./research-launcher";
import { ResearchMethodology } from "./research-methodology";
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
}: {
  session: string | null;
  fromSession: string | null;
  methodology: boolean;
  decisions: boolean;
}) {
  const { active } = useOwner();
  return (
    <div className={styles.desk}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a
            className={styles.homeLink}
            href="?view=research"
            aria-current={
              !session && !fromSession && !methodology && !decisions ? "page" : undefined
            }
          >
            Research desk
          </a>
          <nav aria-label="Research navigation">
            <a
              href={researchDecisionsUrl}
              aria-current={decisions && !session && !methodology ? "page" : undefined}
            >
              Decisions
            </a>
            <a href="?view=methodology" aria-current={methodology && !session ? "page" : undefined}>
              Methodology
            </a>
            <a href="?view=workflow">Workflows</a>
            <a href="?view=evidence">Sources</a>
            <a href="?view=reports">Reports</a>
          </nav>
          <AccessControls key={active ? "active" : "locked"} />
        </div>
      </header>
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
      ) : methodology ? (
        <ResearchMethodology />
      ) : decisions ? (
        <main className={styles.page}>
          <ResearchReviewQueue />
        </main>
      ) : (
        <main className={styles.page}>
          {!fromSession && <ResearchReviewQueue summary />}
          <ResearchLauncher fromSession={fromSession} />
          <RecentStudies />
        </main>
      )}
    </div>
  );
}
