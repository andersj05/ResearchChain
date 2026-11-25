"use client";

import { useEffect, useState } from "react";
import { useOwner } from "./access-context";
import { AccessControls } from "./access-controls";
import { ResearchLauncher } from "./research-launcher";
import { ResearchMethodology } from "./research-methodology";
import { ResearchReviewQueue, researchDecisionsUrl } from "./research-review-queue";
import { ResearchSession } from "./research-session";
import { RunArchive } from "./run-archive";
import { formatTime, RunStatus } from "./run-status";
import { api, type RecentRunSummary } from "@/lib/workflow";
import { sessionUrl } from "@/lib/research-sessions";
import styles from "./research-desk.module.css";

function RecentStudies() {
  const { active } = useOwner();
  const [studies, setStudies] = useState<RecentRunSummary[]>();
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!active) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const items = await api<RecentRunSummary[]>("research-sessions");
        if (!current) return;
        setStudies(items);
        setError("");
        if (items.some((item) => ["queued", "running", "paused"].includes(item.status)))
          timer = setTimeout(read, 5000);
      } catch (cause) {
        if (current)
          setError(cause instanceof Error ? cause.message : "Could not load recent research.");
      }
    }
    void read();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [active, refresh]);
  return (
    <section className={styles.history} aria-labelledby="recent-studies">
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
        <ResearchSession
          runId={session}
          onNewStudy={(source) => {
            window.location.assign(
              source ? `?fromSession=${encodeURIComponent(source)}` : "?view=research",
            );
          }}
        />
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
