"use client";

import { useEffect, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { useOwner } from "./access-context";
import { ownerStoragePrefix } from "@/lib/access";
import { api, ApiError, type RunSnapshot } from "@/lib/workflow";
import { pendingReviews } from "@/lib/run-inspection";
import { evidenceUrl } from "@/lib/evidence";
import { modelSettingLabel, researchRoles } from "@/lib/model-settings";
import { readReviewDrafts, storeReviewDrafts } from "@/lib/run-review-drafts";
import {
  SessionActivity,
  sessionModelProfiles,
  sessionWorkspaces,
  SessionWorkspaceDetail,
} from "./research-session-workspace";
import { formatTime, RunStatus } from "./run-status";
import { SessionDirections } from "./session-directions";
import { SessionDiscovery } from "./session-discovery";
import { SessionRoster } from "./session-roster";
import { LeadConsultation, ConsultationHistory, rememberAnswer } from "./session-consultations";
import { sessionSwarm } from "@/lib/swarm-workspaces";
import styles from "./research-session.module.css";

type Props = { runId: string; onNewStudy: (fromSession?: string) => void };

function OwnerQuestion({
  run,
  question,
  busy,
  act,
}: {
  run: RunSnapshot;
  question: NonNullable<RunSnapshot["review"]>;
  busy: boolean;
  act: (action: string, body: object) => Promise<void>;
}) {
  const { owner } = useOwner();
  const key = ownerStoragePrefix(owner) + ".research.review." + run.id;
  const [answer, setAnswer] = useState(() => readReviewDrafts(key)[question.interrupt_id] ?? "");
  function respond(decision: "approve" | "reject") {
    return act("resume", {
      checkpoint_id: run.checkpoint_id,
      interrupt_id: question.interrupt_id,
      decision,
      feedback: answer,
    });
  }
  return (
    <section className={styles.judgment} aria-labelledby="judgment-title">
      <h2 id="judgment-title">Your judgment</h2>
      <p>{question.question}</p>
      <label htmlFor="editor-feedback">Direction for the editor</label>
      <textarea
        id="editor-feedback"
        maxLength={6000}
        rows={3}
        value={answer}
        disabled={busy}
        onChange={(event) => {
          setAnswer(event.target.value);
          rememberAnswer(key, question.interrupt_id, event.target.value);
        }}
      />
      <div className={styles.actions}>
        <Button className="button primary" disabled={busy} onClick={() => respond("approve")}>
          Continue to report
        </Button>
        <Button className="button" disabled={busy} onClick={() => respond("reject")}>
          End at this review
        </Button>
      </div>
    </section>
  );
}

function ResearchSessionView({ runId, onNewStudy }: Props) {
  const { active, owner } = useOwner();
  const [run, setRun] = useState<RunSnapshot>();
  const [readError, setReadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [acceptedReviews, setAcceptedReviews] = useState<string[]>([]);
  const [chosen, setChosen] = useState(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("workspace"),
  );
  const [passId, setPassId] = useState(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("pass"),
  );
  const draftKey = ownerStoragePrefix(owner) + ".research.review." + runId;
  function selectWorkspace(key: string, pass: string | null = null) {
    setChosen(key);
    setPassId(pass);
    const url = new URL(window.location.href);
    url.searchParams.set("workspace", key);
    if (pass) url.searchParams.set("pass", pass);
    else url.searchParams.delete("pass");
    window.history.replaceState(null, "", url);
  }
  useEffect(() => {
    if (!active || busy) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function observe() {
      try {
        const next = await api<RunSnapshot>(`runs/${encodeURIComponent(runId)}`);
        if (!current) return;
        if (next.research_manifest?.tool_config?.session !== "brief-led-1")
          throw new ApiError("This run belongs to Workflows.", [], 404);
        setRun(next);
        setReadError("");
        if (next.execution_pending || ["queued", "running", "paused"].includes(next.status)) {
          timer = setTimeout(observe, next.status === "paused" ? 4000 : 1200);
        }
        if (
          !next.execution_pending &&
          ["completed", "rejected", "cancelled", "limited", "failed"].includes(next.status)
        )
          storeReviewDrafts(ownerStoragePrefix(owner) + ".research.review." + runId, "{}");
      } catch (cause) {
        if (!current) return;
        setReadError(
          cause instanceof Error ? cause.message : "The session could not be refreshed.",
        );
        if (!(cause instanceof ApiError) || (cause.status ?? 500) >= 500)
          timer = setTimeout(observe, 4000);
      }
    }
    void observe();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [runId, refresh, busy, active, owner]);

  async function act(action: string, body: object) {
    if (busy || !active) return;
    setBusy(true);
    setActionError("");
    try {
      await api(`runs/${encodeURIComponent(runId)}/${action}`, body);
      setConfirmStop(false);
      if (action === "resume" && "interrupt_id" in body && typeof body.interrupt_id === "string") {
        const id = body.interrupt_id;
        setAcceptedReviews((accepted) => [...accepted, id]);
        rememberAnswer(draftKey, id, "");
      }
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "The action could not be confirmed.");
    } finally {
      setBusy(false);
      setRefresh((n) => n + 1);
    }
  }
  const error = readError || actionError;
  const fullRun = `/?view=runs&run=${encodeURIComponent(runId)}`;
  if (!run)
    return (
      <main className={styles.page}>
        <h1>Research session</h1>
        {error ? (
          <div role="alert">
            <p>{error}</p>
            <button onClick={() => setRefresh((n) => n + 1)}>Refresh session</button> ·{" "}
            <a href={fullRun}>Open run inspector</a>
          </div>
        ) : (
          <p role="status">Opening the research session…</p>
        )}
      </main>
    );
  const profiles = sessionModelProfiles(run);
  const lanes = sessionWorkspaces(run, profiles);
  const swarm = sessionSwarm(run);
  const editor = lanes.at(-1)!;
  const team = swarm ? lanes.filter((lane) => lane.role === "researcher") : lanes.slice(1, -1);
  const workspace =
    lanes.find((lane) => lane.key === chosen || (chosen && lane.path === chosen)) ??
    (editor.attempts.length
      ? editor
      : (team.find((lane) =>
          ["preparing", "requesting"].includes(lane.attempts.at(-1)?.status ?? ""),
        ) ??
        team[0] ??
        lanes[0]!));
  const questions = pendingReviews(run).filter(
    (review) => !acceptedReviews.includes(review.interrupt_id),
  );
  const question = questions.find((review) => !review.perspective);
  const discovery = !!run.research_manifest?.tool_config.discovery_version;
  const sentenceReview = question?.path === "root/working_sentence" ? question : undefined;
  const sentenceDecision = run.events.find(
    (event) => event.path === "root/working_sentence" && event.review_response,
  )?.review_response;
  const recordedJudgment = run.events.find(
    (event) => event.review_response && event.path === "root/judgment",
  )?.review_response;
  const title = run.brief.trim().split("\n")[0]!.slice(0, 120);
  const live = run.execution_pending || ["queued", "running"].includes(run.status);
  const started = run.model_attempts?.length ?? 0;
  return (
    <main className={styles.page}>
      <div className={styles.intro}>
        <div className={styles.meta}>
          <RunStatus
            status={run.status}
            label={sentenceDecision?.decision === "reject" ? "Parked" : undefined}
            announce
          />
          <time dateTime={run.created_at}>{formatTime(run.created_at)}</time>
        </div>
        <h1>
          {title}
          {title.length < run.brief.trim().split("\n")[0]!.length && "…"}
        </h1>
        <div className={styles.summary}>
          {swarm && (
            <span>
              Research swarm · {lanes.filter((lane) => lane.role === "lead").length} leads assigned
            </span>
          )}
          <span>
            {team.length
              ? `${team.length} researcher${team.length === 1 ? "" : "s"}`
              : swarm
                ? "No researchers assigned"
                : "Research lead"}
          </span>
          {swarm && (
            <span>
              {lanes.filter((lane) => lane.state === "Active").length} active ·{" "}
              {lanes.filter((lane) => lane.state === "Queued").length} queued
            </span>
          )}
          <span>
            {started} recorded {started === 1 ? "pass" : "passes"}
          </span>
          <span>
            {Math.floor((run.usage?.active_seconds ?? 0) / 60)}m{" "}
            {Math.floor((run.usage?.active_seconds ?? 0) % 60)}s active
          </span>
        </div>
        <details className={styles.settings}>
          <summary>Brief and settings</summary>
          <p>{run.brief}</p>
          {swarm && (
            <p>
              Up to {swarm.lead_count} leads · {swarm.researchers_per_lead} researchers per lead ·{" "}
              {swarm.max_parallel} active slots · {swarm.max_lead_turns} turns per lead · Expert
              consultations {swarm.allow_consultations ? "on" : "off"}
            </p>
          )}
          <p>
            {run.research_manifest?.settings.model} · {run.workflow.budgets?.max_active_seconds}s
            active-time limit · {run.research_manifest?.settings.limits?.max_model_calls} model
            requests maximum
          </p>
          {profiles ? (
            <div className={styles.profileList}>
              <table>
                <caption>Pinned model settings</caption>
                <thead>
                  <tr>
                    <th scope="col">Role</th>
                    <th scope="col">Model</th>
                    <th scope="col">Thinking effort</th>
                    <th scope="col">Response detail</th>
                  </tr>
                </thead>
                <tbody>
                  {researchRoles.map(({ key, label }) => (
                    <tr key={key}>
                      <th scope="row">
                        {swarm && key === "lead" ? "Director and research leads" : label}
                      </th>
                      <td>{profiles[key].model}</td>
                      <td>{modelSettingLabel(profiles[key].reasoning_effort)}</td>
                      <td>{modelSettingLabel(profiles[key].verbosity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>
              This study predates saved role settings. Open a model pass to see its original
              request.
            </p>
          )}
          {!!run.evidence_ids?.length && (
            <ul>
              {run.research_manifest?.evidence.map((source) => (
                <li key={source.evidence_id}>
                  <a href={evidenceUrl(source.evidence_id)}>
                    {run.artifacts.find((item) => item.id === source.original)?.name ||
                      source.publisher ||
                      source.source_url ||
                      source.evidence_id}
                  </a>
                  {source.as_of_date && ` · ${source.as_of_date}`}
                </li>
              ))}
            </ul>
          )}
          {run.baseline_run_id && (
            <a href={`/?session=${encodeURIComponent(run.baseline_run_id)}`}>
              Open baseline session
            </a>
          )}
        </details>
      </div>
      {error && (
        <div className={styles.notice} role="alert">
          {error}{" "}
          <button className="text-link" onClick={() => setRefresh((n) => n + 1)}>
            Refresh session
          </button>
        </div>
      )}
      {run.stop_reason && sentenceDecision?.decision !== "reject" && (
        <p className={styles.notice}>{run.stop_reason}</p>
      )}
      {discovery && (
        <SessionDiscovery
          run={run}
          review={sentenceReview}
          decision={sentenceDecision}
          team={team}
          draftKey={draftKey}
          disabled={busy || !active || run.execution_pending}
          onSelect={selectWorkspace}
          respond={(decision, feedback) =>
            sentenceReview &&
            run.checkpoint_id &&
            void act("resume", {
              checkpoint_id: run.checkpoint_id,
              interrupt_id: sentenceReview.interrupt_id,
              decision,
              feedback,
            })
          }
        />
      )}
      {run.checkpoint_id &&
        questions
          .filter((review) => review.perspective)
          .map((review) => (
            <LeadConsultation
              key={review.interrupt_id}
              review={review}
              runId={runId}
              lanes={lanes}
              draftKey={draftKey}
              onSelect={selectWorkspace}
              disabled={busy || !active || run.execution_pending}
              onAnswer={(feedback) =>
                act("resume", {
                  checkpoint_id: run.checkpoint_id,
                  interrupt_id: review.interrupt_id,
                  decision: "approve",
                  feedback,
                })
              }
            />
          ))}
      <ConsultationHistory run={run} lanes={lanes} onSelect={selectWorkspace} />
      {(!discovery || sentenceDecision?.decision === "approve") && (
        <SessionDirections
          run={run}
          lanes={lanes}
          onSelect={selectWorkspace}
          onRecorded={(note) => {
            setRun((value) => {
              if (!value || value.owner_directions?.some((saved) => saved.id === note.id))
                return value;
              return { ...value, owner_directions: [...(value.owner_directions ?? []), note] };
            });
            setRefresh((n) => n + 1);
          }}
        />
      )}
      {question && !sentenceReview && run.checkpoint_id && (
        <OwnerQuestion
          key={question.interrupt_id}
          question={question}
          run={run}
          busy={busy || !active}
          act={act}
        />
      )}
      {recordedJudgment && (
        <details className={styles.settings}>
          <summary>Recorded editorial judgment</summary>
          <p>
            {recordedJudgment.decision === "reject"
              ? "Ended at review."
              : "Continued to the editor."}{" "}
            {recordedJudgment.feedback}
          </p>
        </details>
      )}
      <div className={styles.work} id="research-workspaces">
        <SessionRoster lanes={lanes} selected={workspace.key} onSelect={selectWorkspace} />
        <SessionWorkspaceDetail
          key={workspace.key}
          lane={workspace}
          run={run}
          passId={passId}
          onPass={(id) => selectWorkspace(workspace.key, id)}
        />
      </div>
      <SessionActivity lanes={lanes} select={selectWorkspace} />
      <footer className={styles.footer}>
        <a href={fullRun}>Open run inspector</a>
        <div className={styles.actions}>
          {run.status === "interrupted" && !live && (
            <Button
              className="button"
              disabled={busy || !active}
              onClick={() => act("recover", {})}
            >
              Recover session
            </Button>
          )}
          {(live || run.status === "paused" || run.status === "interrupted") &&
            (confirmStop ? (
              <>
                <Button
                  className="button"
                  disabled={busy || !active}
                  onClick={() => act("cancel", {})}
                >
                  Confirm stop
                </Button>
                <Button className="button" disabled={busy} onClick={() => setConfirmStop(false)}>
                  Keep session
                </Button>
              </>
            ) : (
              <Button
                className="button"
                disabled={busy || !active}
                onClick={() => setConfirmStop(true)}
              >
                Stop session
              </Button>
            ))}
          <Button className="button" onClick={() => onNewStudy(run.id)}>
            Revisit material
          </Button>
        </div>
      </footer>
    </main>
  );
}

export function ResearchSession(props: Props) {
  return <ResearchSessionView key={props.runId} {...props} />;
}
