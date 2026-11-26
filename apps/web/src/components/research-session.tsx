"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { Button } from "@ui-sdk/react/button";
import { useOwner } from "./access-context";
import { ownerStoragePrefix } from "@/lib/access";
import { api, ApiError, apiResponse, type RunSnapshot } from "@/lib/workflow";
import { pendingReviews } from "@/lib/run-inspection";
import { modelSettingLabel, researchRoles } from "@/lib/model-settings";
import { expertReviewLabels, expertReviewMode, sessionUrl } from "@/lib/research-sessions";
import { readReviewDrafts, storeReviewDrafts } from "@/lib/run-review-drafts";
import { pollVisiblePage } from "@/lib/poll-visible-page";
import {
  finalEditorAttempt,
  sessionModelProfiles,
  sessionReport,
  sessionWorkspaces,
  SessionWorkspaceDetail,
} from "./research-session-workspace";
import { SessionActivity } from "./session-activity";
import { CopyLinkButton } from "./copy-link-button";
import { EditorialReviewEvidence } from "./editorial-review-evidence";
import { formatTime, RunStatus } from "./run-status";
import { SessionDirections } from "./session-directions";
import { SessionDiscovery } from "./session-discovery";
import { SessionReportHandoff } from "./session-report-handoff";
import { SessionRoster } from "./session-roster";
import { hasStudyFiles, StudyFiles } from "./study-files";
import { StudyIndexLink, type StudyIndexReturn } from "./study-index-link";
import { StudyPinnedSources, useStudySourceDetails } from "./study-pinned-sources";
import type { EvidenceRecord } from "@/lib/evidence";
import {
  LeadConsultation,
  ConsultationHistory,
  rememberAnswer,
  SessionWorkspaceLink,
} from "./session-consultations";
import { sessionSwarm } from "@/lib/swarm-workspaces";
import { StudyWorkbenchLink } from "./study-workbench-link";
import { StudyTeamGraph } from "./study-team-graph";
import styles from "./research-session.module.css";

const sessionControlsId = "session-controls";

type Props = {
  runId: string;
  revisitSetup?: { href: string; onClick: MouseEventHandler<HTMLAnchorElement> };
  openRevisitInNewTab?: boolean;
  titleRef?: (title: HTMLHeadingElement | null) => void;
  openWorkbenchInNewTab?: boolean;
  onOpenBaseline?: MouseEventHandler<HTMLAnchorElement>;
  onReuseSource?: (source: EvidenceRecord) => void;
};
type Review = NonNullable<RunSnapshot["review"]>;
type ReturnOrigin =
  { kind: "consultation" | "judgment"; reviewId: string } | ({ kind: "index" } & StudyIndexReturn);
type Decision = "approve" | "reject";
type SessionAction =
  | { name: "resume"; review: Review; decision: Decision; feedback: string }
  | { name: "recover"; failedCommandId?: string; confirmUnrecorded?: boolean }
  | { name: "cancel" };
type ActionFailure = {
  review?: Review;
  checkpoint?: string | null;
  message: string;
  checking: boolean;
};

function OwnerQuestion({
  question,
  draftKey,
  busy,
  onAnswer,
  actionNotice,
  evidence,
}: {
  question: Review;
  draftKey: string;
  busy: boolean;
  onAnswer: (decision: Decision, feedback: string) => Promise<void>;
  actionNotice?: ReactNode;
  evidence?: ReactNode;
}) {
  const [answer, setAnswer] = useState(
    () => readReviewDrafts(draftKey)[question.interrupt_id] ?? "",
  );
  return (
    <section
      className={styles.judgment}
      id="editorial-review"
      aria-labelledby="judgment-title"
      tabIndex={-1}
    >
      <h2 id="judgment-title">Your judgment</h2>
      <p>{question.question}</p>
      {evidence}
      <label htmlFor="editor-feedback">Direction for the editor</label>
      <textarea
        id="editor-feedback"
        maxLength={6000}
        rows={3}
        value={answer}
        disabled={busy}
        onChange={(event) => {
          setAnswer(event.target.value);
          rememberAnswer(draftKey, question.interrupt_id, event.target.value);
        }}
      />
      <div className={styles.actions}>
        <Button
          className="button primary"
          disabled={busy}
          onClick={() => onAnswer("approve", answer)}
        >
          Continue to report
        </Button>
        <Button className="button" disabled={busy} onClick={() => onAnswer("reject", answer)}>
          End at this review
        </Button>
      </div>
      {actionNotice}
    </section>
  );
}

function ResearchSessionView({
  runId,
  revisitSetup,
  openRevisitInNewTab,
  titleRef,
  openWorkbenchInNewTab,
  onOpenBaseline,
  onReuseSource,
}: Props) {
  const { active, owner } = useOwner();
  const [run, setRun] = useState<RunSnapshot>();
  const lastObservation = useRef<{ body: string; run: RunSnapshot } | undefined>(undefined);
  const [readingSourcesRequested, setReadingSourcesRequested] = useState(false);
  const sourceDetails = useStudySourceDetails(run, active, readingSourcesRequested);
  const [readError, setReadError] = useState("");
  const [actionFailure, setActionFailure] = useState<ActionFailure>();
  const sending = useRef(false);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmedRecovery, setConfirmedRecovery] = useState<string>();
  const stopChoice = useRef<HTMLButtonElement>(null);
  const focusStopChoice = useRef(false);
  const [acceptedReviews, setAcceptedReviews] = useState<string[]>([]);
  const [returnOrigin, setReturnOrigin] = useState<ReturnOrigin>();
  const returnToSavedFile = useRef<((targetId: string) => void) | null>(null);
  const returnToActivity = useRef<((targetId: string) => void) | null>(null);
  const [chosen, setChosen] = useState(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("workspace"),
  );
  const [passId, setPassId] = useState(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("pass"),
  );
  const draftKey = ownerStoragePrefix(owner) + ".research.review." + runId;

  useLayoutEffect(() => {
    if (!focusStopChoice.current) return;
    focusStopChoice.current = false;
    stopChoice.current?.focus();
  }, [confirmStop]);

  function selectWorkspace(key: string, pass: string | null = null, origin?: ReturnOrigin) {
    setChosen(key);
    setPassId(pass);
    setReturnOrigin(origin);
    const url = new URL(window.location.href);
    url.searchParams.set("workspace", key);
    if (pass) url.searchParams.set("pass", pass);
    else url.searchParams.delete("pass");
    window.history.replaceState(null, "", url);
  }
  useEffect(() => {
    if (!active) {
      lastObservation.current = undefined;
      return;
    }
    if (busy) return;
    return pollVisiblePage(async ({ isCurrent, schedule }) => {
      try {
        const response = await apiResponse(`runs/${encodeURIComponent(runId)}`);
        const body = await response.text();
        if (!isCurrent()) return;
        // Results can change without adding a receipt or changing the checkpoint.
        const previous = lastObservation.current;
        const next = previous?.body === body ? previous.run : (JSON.parse(body) as RunSnapshot);
        if (next.research_manifest?.tool_config?.session !== "brief-led-1")
          throw new ApiError("This run belongs to Workflows.", [], 404);
        const keepsPolling =
          next.execution_pending || ["queued", "running", "paused"].includes(next.status);
        if (!keepsPolling) lastObservation.current = undefined;
        else if (next !== previous?.run) lastObservation.current = { body, run: next };
        if (pendingReviews(next).some((review) => review.path === "root/working_sentence"))
          setReadingSourcesRequested(true);
        setRun(next);
        setReadError("");
        setActionFailure((failure) =>
          failure?.checking ? { ...failure, checking: false } : failure,
        );
        if (keepsPolling) schedule(next.status === "paused" ? 4000 : 1200);
        if (
          !next.execution_pending &&
          ["completed", "rejected", "cancelled", "limited", "failed"].includes(next.status)
        )
          storeReviewDrafts(draftKey, "{}");
      } catch (cause) {
        if (!isCurrent()) return;
        setReadError(
          cause instanceof Error ? cause.message : "The session could not be refreshed.",
        );
        if (!(cause instanceof ApiError) || (cause.status ?? 500) >= 500) schedule(4000);
      }
    });
  }, [runId, refresh, busy, active, draftKey]);

  const loaded = !!run;
  const profiles = useMemo(() => (run ? sessionModelProfiles(run) : undefined), [run]);
  const lanes = useMemo(() => (run ? sessionWorkspaces(run, profiles) : []), [run, profiles]);
  useEffect(() => {
    if (!loaded) return;
    const anchor = window.location.hash.slice(1);
    const target = document.getElementById(anchor);
    if (!target) return;
    if (
      anchor === "source-led-investigation" ||
      anchor === "editorial-review" ||
      anchor === sessionControlsId ||
      anchor.startsWith("consultation-")
    ) {
      target.focus({ preventScroll: true });
    }
    target.scrollIntoView({ block: "start" });
  }, [loaded]);

  async function act(action: SessionAction) {
    if (sending.current || !active) return;
    const checkpoint = run?.checkpoint_id;
    const review = action.name === "resume" ? action.review : undefined;
    if (review && (!checkpoint || run?.execution_pending || actionFailure?.checking)) return;
    const body =
      action.name === "resume"
        ? {
            checkpoint_id: checkpoint,
            interrupt_id: action.review.interrupt_id,
            decision: action.decision,
            feedback: action.feedback,
          }
        : action.name === "recover" && action.failedCommandId
          ? {
              failed_command_id: action.failedCommandId,
              ...(action.confirmUnrecorded && { confirm_unrecorded: true }),
            }
          : {};
    sending.current = true;
    setBusy(true);
    setActionFailure(undefined);
    try {
      await api(`runs/${encodeURIComponent(runId)}/${action.name}`, body);
      setConfirmStop(false);
      if (review) {
        setAcceptedReviews((accepted) => [...accepted, review.interrupt_id]);
        rememberAnswer(draftKey, review.interrupt_id, "");
      }
    } catch (cause) {
      setActionFailure({
        review,
        checkpoint,
        message: cause instanceof Error ? cause.message : "The action could not be confirmed.",
        checking: !!review,
      });
    } finally {
      sending.current = false;
      setBusy(false);
      setRefresh((n) => n + 1);
    }
  }
  function respond(review: Review, decision: Decision, feedback: string) {
    return act({ name: "resume", review, decision, feedback });
  }
  const fullRun = `/?view=runs&run=${encodeURIComponent(runId)}`;
  if (!run)
    return (
      <main className={styles.page}>
        <h1 ref={readError ? titleRef : undefined} tabIndex={-1}>
          Research session
        </h1>
        {readError ? (
          <div role="alert">
            <p>{readError}</p>
            <button onClick={() => setRefresh((n) => n + 1)}>Refresh session</button> ·{" "}
            <StudyWorkbenchLink href={fullRun} newTab={openWorkbenchInNewTab}>
              Open run inspector
            </StudyWorkbenchLink>
          </div>
        ) : (
          <p role="status">Opening the research session…</p>
        )}
      </main>
    );
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
  const failedReview = actionFailure?.review;
  const unavailableReview =
    failedReview && !questions.some((review) => review.interrupt_id === failedReview.interrupt_id)
      ? failedReview
      : undefined;
  const refreshedReview =
    failedReview &&
    !unavailableReview &&
    !actionFailure?.checking &&
    !run.execution_pending &&
    run.checkpoint_id &&
    run.checkpoint_id !== actionFailure?.checkpoint;
  const actionNotice = actionFailure && (
    <div className={styles.actionError} role="alert">
      <p>{actionFailure.message}</p>
      {unavailableReview && (
        <p>
          {unavailableReview.perspective
            ? `The question from ${unavailableReview.perspective.lead_title}`
            : "The earlier question"}{" "}
          is unavailable at the current checkpoint.
        </p>
      )}
      {actionFailure.checking &&
        (readError ? (
          <p>
            Could not check the current question.{" "}
            <button className="text-link" onClick={() => setRefresh((n) => n + 1)}>
              Refresh session
            </button>
          </p>
        ) : (
          <p>Checking the current question…</p>
        ))}
      {refreshedReview && <p>The study has refreshed. You can try again.</p>}
    </div>
  );
  function noticeFor(review?: Review) {
    return review && review.interrupt_id === failedReview?.interrupt_id ? actionNotice : undefined;
  }
  const reviewsDisabled = busy || !active || run.execution_pending || !!actionFailure?.checking;
  const consultations = questions.filter((review) => review.perspective);
  const returnQuestion =
    returnOrigin?.kind === "consultation"
      ? consultations.find((review) => review.interrupt_id === returnOrigin.reviewId)
      : undefined;
  const question = questions.find((review) => !review.perspective);
  const discovery = !!run.research_manifest?.tool_config.discovery_version;
  const sentenceReview = question?.path === "root/working_sentence" ? question : undefined;
  const sentenceDecision = run.events.find(
    (event) => event.path === "root/working_sentence" && event.review_response,
  )?.review_response;
  const recordedJudgment = run.events.find(
    (event) => event.review_response && event.path === "root/judgment",
  )?.review_response;
  const briefTitle = run.brief.trim().split("\n")[0] || run.workflow_name;
  const title =
    run.study_title?.trim() ||
    (briefTitle.length > 120 ? `${briefTitle.slice(0, 120)}…` : briefTitle);
  const live = run.execution_pending || ["queued", "running"].includes(run.status);
  const canStop = live || run.status === "paused" || run.status === "interrupted";
  const failedCommandId = run.recovery_command_id;
  const confirmedUnrecorded = !!failedCommandId && confirmedRecovery === failedCommandId;
  const started = run.model_attempts?.length ?? 0;
  const activeSeconds = run.usage?.active_seconds;
  const report = sessionReport(editor, run.status);
  const finalEditor = report ? undefined : finalEditorAttempt(editor, run.status);
  const editorFindings =
    finalEditor?.result?.conclusion.trim() &&
    !finalEditor.result.report_artifact &&
    !finalEditor.result.workspace_files?.length
      ? finalEditor
      : undefined;
  const hasActivity = lanes.some((lane) => lane.attempts.length > 0);
  const hasFiles = hasStudyFiles(lanes, run.artifacts);
  const showSteering =
    (!discovery || sentenceDecision?.decision === "approve") &&
    run.research_manifest?.tool_config.owner_directions_version === "owner-directions-1";
  const steeringLink =
    showSteering &&
    ((canStop && !editor?.attempts.length) ||
      !!run.owner_directions?.length ||
      !!run.owner_report_request);
  const returnIndex =
    returnOrigin?.kind === "index" && (returnOrigin.index === "activity" ? hasActivity : hasFiles)
      ? returnOrigin
      : undefined;
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
          <CopyLinkButton
            getUrl={() => new URL(sessionUrl(run.id), window.location.origin)}
            button="Copy study link"
            success="Study link copied."
          />
        </div>
        <div className={styles.titleRow}>
          <h1 ref={titleRef} tabIndex={-1}>
            {title}
          </h1>
          <a
            className="button"
            href={revisitSetup?.href ?? `?fromSession=${encodeURIComponent(run.id)}`}
            onClick={revisitSetup?.onClick}
            target={openRevisitInNewTab ? "_blank" : undefined}
            rel={openRevisitInNewTab ? "noopener" : undefined}
          >
            {openRevisitInNewTab ? "Revisit material (new tab)" : "Revisit material"}
          </a>
        </div>
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
            {activeSeconds == null
              ? "Active time unreported"
              : `${Math.floor(activeSeconds / 60)}m ${Math.floor(activeSeconds % 60)}s active`}
          </span>
        </div>
        <nav
          id="study-sections"
          aria-label="Study sections"
          className={styles.studyNav}
          tabIndex={-1}
        >
          {report ? (
            <SessionWorkspaceLink
              className={report.complete ? styles.reportShortcut : undefined}
              runId={runId}
              lane={editor}
              onSelect={selectWorkspace}
            >
              {report.complete ? "Read report" : "Read report draft"}
            </SessionWorkspaceLink>
          ) : (
            editorFindings && (
              <SessionWorkspaceLink
                className={styles.reportShortcut}
                runId={runId}
                lane={editor}
                pass={editorFindings.id}
                onSelect={selectWorkspace}
              >
                Read editor findings
              </SessionWorkspaceLink>
            )
          )}
          {discovery && (
            <a
              href="#source-led-investigation"
              className={sentenceReview ? styles.reviewShortcut : undefined}
            >
              {sentenceReview
                ? "Choose working sentence"
                : sentenceDecision?.decision === "reject"
                  ? "Parked study"
                  : sentenceDecision
                    ? "Working sentence"
                    : "First reading"}
            </a>
          )}
          {run.checkpoint_id &&
            consultations.map((review) => (
              <a
                key={review.interrupt_id}
                href={`#consultation-${review.interrupt_id}`}
                className={styles.reviewShortcut}
              >
                Question from {review.perspective?.lead_title}
              </a>
            ))}
          {question && !sentenceReview && run.checkpoint_id && (
            <a href="#editorial-review" className={styles.reviewShortcut}>
              Editorial review
            </a>
          )}
          {run.baseline_run_id && (
            <StudyWorkbenchLink
              href={`${fullRun}&compare=${encodeURIComponent(run.baseline_run_id)}`}
              newTab={openWorkbenchInNewTab}
            >
              Compare with baseline
            </StudyWorkbenchLink>
          )}
          {canStop && <a href={`#${sessionControlsId}`}>Session controls</a>}
          {steeringLink && <a href="#study-steering">Team guidance</a>}
          {swarm && <a href="#study-team-graph">Team graph</a>}
          <a href="#research-workspaces">Workspaces</a>
          {live && (
            <a className={styles.phoneSectionLink} href="#current-research-workspace">
              Current workspace
            </a>
          )}
          {hasFiles && <StudyIndexLink index="files" />}
          {hasActivity && <StudyIndexLink index="activity" />}
        </nav>
        <details
          className={styles.settings}
          onToggle={(event) => {
            if (active && event.currentTarget.open) sourceDetails.requestSettings();
          }}
        >
          <summary>{discovery ? "Sources and settings" : "Brief and settings"}</summary>
          {(!discovery || run.brief !== "Source-led study") && <p>{run.brief}</p>}
          {swarm && (
            <p>
              Up to {swarm.lead_count} leads · {swarm.researchers_per_lead} researchers per lead ·{" "}
              {swarm.max_parallel} active slots ·{" "}
              {swarm.max_lead_turns === null
                ? "Leads finish when ready"
                : `${swarm.max_lead_turns} turns per lead`}{" "}
              · Expert judgment · {expertReviewLabels[expertReviewMode(swarm)]}
            </p>
          )}
          <p>
            {run.research_manifest?.settings.model} · No active-time limit ·{" "}
            {run.research_manifest?.settings.limits?.max_model_calls} model steps maximum
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
          {active && sourceDetails.settingsRequested && (
            <StudyPinnedSources
              lookup={sourceDetails}
              artifacts={run.artifacts}
              onReuseSource={onReuseSource}
            />
          )}
          {run.baseline_run_id && (
            <a
              href={`/?session=${encodeURIComponent(run.baseline_run_id)}`}
              onClick={onOpenBaseline}
            >
              Open baseline session
            </a>
          )}
        </details>
      </div>
      {readError && (
        <div className={styles.notice} role="alert">
          {readError}{" "}
          <button className="text-link" onClick={() => setRefresh((n) => n + 1)}>
            Refresh session
          </button>
        </div>
      )}
      {run.stop_reason && sentenceDecision?.decision !== "reject" && (
        <div className={styles.notice}>
          <p>{run.stop_reason}</p>
          {failedCommandId && (
            <>
              <p>
                {run.status === "limited"
                  ? "Resume from the saved checkpoint and reuse the completed steps."
                  : "Resume from the saved checkpoint. Retried requests use your plan allowance."}
              </p>
              {run.recovery_requires_confirmation && (
                <label className={styles.resumeConfirmation}>
                  <input
                    type="checkbox"
                    checked={confirmedUnrecorded}
                    disabled={!active || busy}
                    onChange={(event) =>
                      setConfirmedRecovery(event.target.checked ? failedCommandId : undefined)
                    }
                  />
                  Retry the request with no recorded outcome. It may use another request from your
                  allowance.
                </label>
              )}
              <Button
                className="button primary"
                disabled={
                  busy || !active || (!!run.recovery_requires_confirmation && !confirmedUnrecorded)
                }
                pendingAnnouncement="Resuming research"
                onClick={() =>
                  act({ name: "recover", failedCommandId, confirmUnrecorded: confirmedUnrecorded })
                }
              >
                Resume research
              </Button>
              {!failedReview && actionNotice}
            </>
          )}
        </div>
      )}
      {discovery && (
        <SessionDiscovery
          run={run}
          reading={sourceDetails.reading}
          sources={sourceDetails.sources}
          readingRequested={readingSourcesRequested}
          onReadOriginal={() => setReadingSourcesRequested(true)}
          review={sentenceReview}
          decision={sentenceDecision}
          team={team}
          draftKey={draftKey}
          disabled={reviewsDisabled || !run.checkpoint_id}
          actionNotice={noticeFor(sentenceReview)}
          onSelect={selectWorkspace}
          respond={(decision, feedback) => {
            if (sentenceReview) void respond(sentenceReview, decision, feedback);
          }}
        />
      )}
      {unavailableReview?.path === "root/working_sentence" && actionNotice}
      {run.checkpoint_id &&
        consultations.map((review) => (
          <LeadConsultation
            key={review.interrupt_id}
            review={review}
            runId={runId}
            lanes={lanes}
            draftKey={draftKey}
            actionNotice={noticeFor(review)}
            onSelect={(key, pass) =>
              selectWorkspace(key, pass, { kind: "consultation", reviewId: review.interrupt_id })
            }
            disabled={reviewsDisabled}
            onAnswer={(feedback) => respond(review, "approve", feedback)}
          />
        ))}
      {unavailableReview?.perspective && actionNotice}
      <ConsultationHistory run={run} lanes={lanes} onSelect={selectWorkspace} />
      {showSteering && (
        <div className={styles.steering} id="study-steering">
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
          <SessionReportHandoff
            run={run}
            onRequested={(receipt) => {
              setRun((value) => value && { ...value, owner_report_request: receipt });
              setRefresh((n) => n + 1);
            }}
            onRefresh={() => setRefresh((n) => n + 1)}
          />
        </div>
      )}
      {question && !sentenceReview && run.checkpoint_id && (
        <OwnerQuestion
          key={question.interrupt_id}
          question={question}
          draftKey={draftKey}
          busy={reviewsDisabled}
          actionNotice={noticeFor(question)}
          onAnswer={(decision, feedback) => respond(question, decision, feedback)}
          evidence={
            question.path === "root/judgment" && (
              <EditorialReviewEvidence
                lanes={lanes}
                question={question.question}
                runId={runId}
                onSelect={(key, pass) =>
                  selectWorkspace(key, pass, { kind: "judgment", reviewId: question.interrupt_id })
                }
              />
            )
          }
        />
      )}
      {unavailableReview &&
        unavailableReview.path !== "root/working_sentence" &&
        !unavailableReview.perspective &&
        actionNotice}
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
      {swarm && (
        <StudyTeamGraph
          run={run}
          lanes={lanes}
          consultations={consultations}
          editorialReview={question?.path === "root/judgment" && !!run.checkpoint_id}
          selected={workspace.key}
          onSelect={selectWorkspace}
        />
      )}
      <div className={styles.work} id="research-workspaces" tabIndex={-1}>
        <SessionRoster lanes={lanes} selected={workspace.key} onSelect={selectWorkspace} />
        <SessionWorkspaceDetail
          key={workspace.key}
          lane={workspace}
          run={run}
          openWorkbenchInNewTab={openWorkbenchInNewTab}
          showStudySections={live}
          passId={passId}
          onPass={(id) =>
            selectWorkspace(
              workspace.key,
              id,
              id === null && returnOrigin?.kind === "index" ? undefined : returnOrigin,
            )
          }
          returnToReview={
            returnQuestion?.perspective
              ? { id: returnQuestion.interrupt_id, title: returnQuestion.perspective.lead_title }
              : undefined
          }
          returnToJudgment={
            question?.path === "root/judgment" &&
            !!run.checkpoint_id &&
            returnOrigin?.kind === "judgment" &&
            returnOrigin.reviewId === question.interrupt_id
          }
          returnToIndex={returnIndex}
          onReturnToIndex={(index, targetId) => {
            const target = index === "files" ? returnToSavedFile : returnToActivity;
            target.current?.(targetId);
          }}
        />
      </div>
      {hasFiles && (
        <StudyFiles
          runId={runId}
          lanes={lanes}
          artifacts={run.artifacts}
          returnRef={returnToSavedFile}
          onSelect={(key, pass, targetId) =>
            selectWorkspace(key, pass, { kind: "index", index: "files", targetId })
          }
        />
      )}
      <SessionActivity
        lanes={lanes}
        returnRef={returnToActivity}
        select={(key, pass, targetId) =>
          selectWorkspace(key, pass, { kind: "index", index: "activity", targetId })
        }
      />
      <footer
        className={styles.footer}
        id={canStop ? sessionControlsId : undefined}
        tabIndex={canStop ? -1 : undefined}
      >
        {!failedReview && !failedCommandId && actionNotice}
        <StudyWorkbenchLink href={fullRun} newTab={openWorkbenchInNewTab}>
          Open run inspector
        </StudyWorkbenchLink>
        {canStop && (
          <div className={styles.actions}>
            {run.status === "interrupted" && !live && (
              <Button
                className="button"
                disabled={busy || !active}
                onClick={() => act({ name: "recover" })}
              >
                Recover session
              </Button>
            )}
            {confirmStop ? (
              <>
                <Button
                  className="button"
                  disabled={busy || !active}
                  onClick={() => act({ name: "cancel" })}
                >
                  Confirm stop
                </Button>
                <Button
                  ref={stopChoice}
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    focusStopChoice.current = true;
                    setConfirmStop(false);
                    if (!failedReview) setActionFailure(undefined);
                  }}
                >
                  Keep session
                </Button>
              </>
            ) : (
              <Button
                ref={stopChoice}
                className="button"
                disabled={busy || !active}
                onClick={() => {
                  focusStopChoice.current = true;
                  setConfirmStop(true);
                }}
              >
                Stop session
              </Button>
            )}
          </div>
        )}
      </footer>
    </main>
  );
}

export function ResearchSession(props: Props) {
  return <ResearchSessionView key={props.runId} {...props} />;
}
