import type { components } from "@researchchain/contracts";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { contentDownloadUrl } from "@/lib/evidence";
import { modelSettingLabel, resolveModelProfile } from "@/lib/model-settings";
import { modelAttemptStatus } from "@/lib/run-inspection";
import {
  groupAnalystPasses,
  sessionSwarm,
  swarmWorkspaces,
  type SessionWorkspace,
} from "@/lib/swarm-workspaces";
import type { RunSnapshot } from "@/lib/workflow";
import { CopyLinkButton } from "./copy-link-button";
import { ResearchMarkdown } from "./research-markdown";
import { ResearchToolReceipts, researchToolUrls } from "./research-tool-receipts";
import {
  canPreviewWorkspaceFile,
  ResearchWorkspace,
  WorkspaceFilePreview,
  WorkspaceFiles,
} from "./research-workspace";
import { formatTime } from "./run-status";
import { StudyBaselineReport } from "./study-baseline-report";
import { StudyIndexLink, type StudyIndexReturn } from "./study-index-link";
import styles from "./research-session.module.css";

type Attempt = components["schemas"]["ModelAttempt"];
type WorkspaceFile = components["schemas"]["WorkspaceFile"];

export function focusSessionWorkspace() {
  const url = new URL(window.location.href);
  url.hash = "current-research-workspace";
  window.history.replaceState(null, "", url);
  requestAnimationFrame(() => {
    const workspace = document.getElementById("current-research-workspace");
    workspace?.focus({ preventScroll: true });
    workspace?.scrollIntoView({ block: "start" });
  });
}

export function sessionModelProfiles(run: RunSnapshot) {
  const shared = run.research_manifest?.settings;
  if (!shared || run.research_manifest?.tool_config.model_settings_version !== "model-settings-1")
    return;
  const team = run.workflow.nodes?.find((node) => node.id === "team")?.config;
  const editor = run.workflow.nodes?.find((node) => node.id === "report")?.config;
  const teamConfig = team?.type === "research" ? team : undefined;
  const teamProfile = resolveModelProfile(shared, teamConfig);
  return {
    lead: resolveModelProfile(teamProfile, teamConfig?.team?.lead),
    researcher: resolveModelProfile(teamProfile, teamConfig?.team?.researcher),
    editor: resolveModelProfile(shared, editor?.type === "research" ? editor : undefined),
  };
}

export function sessionWorkspaces(
  run: RunSnapshot,
  profiles: ReturnType<typeof sessionModelProfiles>,
): SessionWorkspace[] {
  if (sessionSwarm(run)) return swarmWorkspaces(run, profiles);
  const attempts = run.model_attempts ?? [];
  const director = attempts.find((item) => item.path === "root/team/plan");
  const plan = director?.result?.team_plan;
  const groupedPasses = groupAnalystPasses(attempts);
  return [
    {
      key: "lead",
      title: "Research lead",
      objective: "Choose investigations for the brief.",
      attempts: attempts.filter((item) => item.path === "root/discovery" || item === director),
      profile: profiles?.lead,
    },
    ...(plan?.assignments ?? []).map((assignment, index) => ({
      key: `agent-${index + 1}`,
      title: assignment.title,
      objective: assignment.objective,
      attempts: groupedPasses.get(`root/team/agent-${index + 1}`) ?? [],
      profile: profiles?.researcher,
    })),
    {
      key: "editor",
      title: "Report editor",
      objective: "Write the report from the team's findings and files.",
      attempts: groupedPasses.get("root/report") ?? [],
      profile: profiles?.editor,
    },
  ];
}

export function activityLabel(lane: SessionWorkspace) {
  const attempt = lane.attempts.at(-1);
  if (lane.state)
    return lane.state === "Active" && attempt
      ? `Active · ${modelAttemptStatus(attempt)}`
      : lane.state;
  if (!attempt) return "Not started";
  if (attempt.status !== "completed") return modelAttemptStatus(attempt);
  if (attempt.result?.workspace_activity) return "Python result saved";
  if (attempt.result?.next_lead) return "Lead saved";
  if (attempt.result?.discovery) return "First reading saved";
  if (attempt.result?.team_plan) return "Plan saved";
  return lane.key === "editor" ? "Report response saved" : "Findings saved";
}

function sourceUrls(attempts: Attempt[]) {
  return new Set(
    attempts.flatMap(({ result }) => [
      ...(result?.web_research?.sources.map((source) => source.url) ?? []),
      ...researchToolUrls(result),
    ]),
  );
}

export function finalEditorAttempt(lane: SessionWorkspace, status: RunSnapshot["status"]) {
  if (lane.key !== "editor" || status !== "completed") return;
  const latest = lane.attempts.at(-1);
  if (
    latest?.status === "completed" &&
    latest.result &&
    !latest.result.workspace_activity &&
    !latest.result.next_lead
  )
    return latest;
}

function editorMarkdown(files: WorkspaceFile[], complete: boolean) {
  return (
    files.find((item) => item.name === "report.md") ??
    (complete ? files.find((item) => item.name.toLowerCase().endsWith(".md")) : undefined)
  );
}

export function sessionReport(lane: SessionWorkspace, status: RunSnapshot["status"]) {
  if (lane.key !== "editor") return;
  const latest = lane.attempts.at(-1);
  const result = latest?.result ?? lane.attempts.findLast((attempt) => attempt.result)?.result;
  const complete = !!finalEditorAttempt(lane, status);
  const file = editorMarkdown(result?.workspace_files ?? [], complete);
  if (file) return { file, complete };
}

function baselineReport(run: RunSnapshot) {
  const editor = sessionWorkspaces(run, undefined).at(-1);
  const final = editor && finalEditorAttempt(editor, run.status);
  const files = final?.result?.workspace_files ?? [];
  const file = editorMarkdown(files, true);
  if (!file || !file.media_type.startsWith("text/") || file.byte_size <= 0) return;
  const receipt = final?.result?.report_artifact;
  if (
    receipt &&
    (receipt.name !== file.name ||
      receipt.artifact_id !== file.artifact_id ||
      receipt.media_type !== file.media_type ||
      receipt.byte_size !== file.byte_size)
  )
    return;
  return { file, files, sources: sourceUrls(run.model_attempts ?? []) };
}

type Result = NonNullable<Attempt["result"]>;

function WorkspaceAssignments({
  assignments,
}: {
  assignments: components["schemas"]["TeamAssignment"][];
}) {
  return (
    <ol className={styles.assignments}>
      {assignments.map((item, index) => (
        <li key={index}>
          <strong>{item.title}</strong>
          <p>{item.objective}</p>
        </li>
      ))}
    </ol>
  );
}

function SwarmDecision({ action }: { action: NonNullable<Result["swarm_action"]> }) {
  if (action.action === "delegate")
    return (
      <div className={styles.findings}>
        <h3>Delegated research</h3>
        <p>{action.rationale}</p>
        <WorkspaceAssignments assignments={action.assignments} />
      </div>
    );
  if (action.action === "ask_expert")
    return (
      <div className={styles.findings}>
        <h3>Expert consultation</h3>
        <p>
          <strong>Working thesis</strong> · {action.consultation.thesis}
        </p>
        <p>{action.consultation.question}</p>
        {!!action.consultation.options?.length && (
          <ul>
            {action.consultation.options.map((option) => (
              <li key={option}>{option}</li>
            ))}
          </ul>
        )}
      </div>
    );
  return (
    <div className={styles.findings}>
      <h3>Lead findings</h3>
      <p>{action.findings}</p>
      <details>
        <summary>Limitations</summary>
        <ul>
          {action.limitations.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

type PassSelection = { passId: string | null; onPass: (id: string | null) => void };

function PassPicker({
  attempts,
  passId,
  onPass,
}: Pick<SessionWorkspace, "attempts"> & PassSelection) {
  return (
    <label>
      Inspect model pass
      <select
        value={passId ?? ""}
        onChange={(event) => {
          onPass(event.target.value);
          if (passId === null) focusSessionWorkspace();
        }}
      >
        <option value="" disabled>
          Choose a pass
        </option>
        {attempts.map((attempt, index) => (
          <option key={attempt.id} value={attempt.id}>
            Pass {index + 1} · {modelAttemptStatus(attempt)}
          </option>
        ))}
      </select>
    </label>
  );
}

function SavedFindings({
  result,
  sources,
  files,
}: {
  result: Result;
  sources: Set<string>;
  files: WorkspaceFile[];
}) {
  return (
    <div className={styles.findings}>
      {result.conclusion && (
        <ResearchMarkdown text={result.conclusion} sources={sources} files={files} />
      )}
      {result.review_question && (
        <p>
          <strong>Question for the owner</strong>
          <br />
          {result.review_question}
        </p>
      )}
      {!!result.limitations.length && (
        <details>
          <summary>Limitations</summary>
          <ul>
            {result.limitations.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function RecordedSources({ urls, hidden }: { urls: Set<string>; hidden?: boolean }) {
  if (!urls.size) return null;
  return (
    <details className={styles.receipts} hidden={hidden}>
      <summary>Recorded sources ({urls.size})</summary>
      <ul>
        {[...urls].map((url) => (
          <li key={url}>
            <a href={url} target="_blank" rel="noreferrer">
              {url}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

function PassReceipt({
  lane,
  selected,
  runId,
  onPass,
}: {
  lane: SessionWorkspace;
  selected: Attempt;
  runId: string;
  onPass: PassSelection["onPass"];
}) {
  const result = selected.result;
  const activity = result?.workspace_activity;
  const assignments = result?.swarm_plan?.leads ?? result?.team_plan?.assignments;
  const inspectorHref = `/?${new URLSearchParams({ view: "runs", run: runId, attempt: selected.id })}`;
  const urls = sourceUrls([selected]);
  const files = [
    ...new Map(
      [...(activity?.files ?? []), ...(result?.workspace_files ?? [])].map((file) => [
        file.name,
        file,
      ]),
    ).values(),
  ];
  return (
    <section className={styles.pass} aria-labelledby="saved-pass-heading">
      <div className={styles.passHeading}>
        <h3 id="saved-pass-heading">Pass {lane.attempts.indexOf(selected) + 1}</h3>
        <span>{modelAttemptStatus(selected)}</span>
      </div>
      <PassPicker attempts={lane.attempts} passId={selected.id} onPass={onPass} />
      <div className={styles.passMeta}>
        <span>
          {selected.model}
          {selected.returned_model &&
            selected.returned_model !== selected.model &&
            ` · Returned ${selected.returned_model}`}{" "}
          · Started {formatTime(selected.created_at)}
          {selected.finished_at && ` · Finished ${formatTime(selected.finished_at)}`}
        </span>
        {lane.profile && (
          <span>
            Thinking effort · {modelSettingLabel(lane.profile.reasoning_effort)} · Response detail ·{" "}
            {modelSettingLabel(lane.profile.verbosity)}
          </span>
        )}
        {(selected.input_tokens != null || selected.output_tokens != null) && (
          <span>
            Tokens in {selected.input_tokens?.toLocaleString() ?? "unreported"} · out{" "}
            {selected.output_tokens?.toLocaleString() ?? "unreported"}
          </span>
        )}
      </div>
      <div className={styles.receiptLinks}>
        {selected.input_artifact_id && (
          <a href={contentDownloadUrl(selected.input_artifact_id, "request.json")} download>
            Saved request
          </a>
        )}
        {selected.response_artifact_id && (
          <a href={contentDownloadUrl(selected.response_artifact_id, "response.txt")} download>
            Saved response
          </a>
        )}
        <a href={inspectorHref}>Inspect pass in Runs</a>
        <CopyLinkButton
          key={selected.id}
          getUrl={() => new URL(inspectorHref, window.location.origin)}
          button="Copy pass link"
          success="Pass link copied."
        />
      </div>
      {activity && (
        <div>
          <p>
            Python {activity.status} · {activity.summary}
          </p>
          {activity.output && (
            <details className={styles.receipts}>
              <summary>Execution output</summary>
              <pre className={styles.passOutput} tabIndex={0}>
                {activity.output}
              </pre>
            </details>
          )}
        </div>
      )}
      {result?.discovery && (
        <div className={styles.findings}>
          <p>{result.discovery.observation}</p>
          <a href="#source-led-investigation">Read the lead’s first reading</a>
        </div>
      )}
      {result?.swarm_action && <SwarmDecision action={result.swarm_action} />}
      {assignments && <WorkspaceAssignments assignments={assignments} />}
      {result?.next_lead && !activity && <p>{result.next_lead}</p>}
      {result?.conclusion && !activity && (
        <SavedFindings result={result} sources={urls} files={files} />
      )}
      {selected.reason && <p>{selected.reason}</p>}
      {!!files.length && (
        <WorkspaceFiles key={selected.id} files={files} sources={urls} label="Files in this pass" />
      )}
      <RecordedSources urls={urls} />
      {result && <ResearchToolReceipts result={result} />}
    </section>
  );
}

export function SessionWorkspaceDetail({
  lane,
  run,
  showStudySections,
  passId,
  onPass,
  returnToReview,
  returnToJudgment,
  returnToIndex,
  onReturnToIndex,
}: {
  lane: SessionWorkspace;
  run: RunSnapshot;
  showStudySections?: boolean;
  returnToReview?: { id: string; title: string };
  returnToJudgment?: boolean;
  returnToIndex?: StudyIndexReturn;
  onReturnToIndex: (index: StudyIndexReturn["index"], targetId: string) => void;
} & PassSelection) {
  const selected = lane.attempts.find((attempt) => attempt.id === passId);
  return (
    <section
      id="current-research-workspace"
      className={styles.detail}
      aria-label={`${lane.title} workspace`}
      tabIndex={-1}
    >
      {showStudySections && (
        <a className={`text-link ${styles.phoneSectionLink}`} href="#study-sections">
          Study sections
        </a>
      )}
      {returnToReview && (
        <a className="text-link" href={`#consultation-${returnToReview.id}-answer`}>
          Return to {returnToReview.title}’s question
        </a>
      )}
      {returnToJudgment && (
        <a
          className="text-link"
          href="#editor-feedback"
          onClick={(event) => {
            if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
              return;
            const target =
              document.querySelector<HTMLElement>("#editor-feedback:enabled") ??
              document.getElementById("editorial-review");
            if (!target) return;
            event.preventDefault();
            window.history.replaceState(null, "", `#${target.id}`);
            target.focus({ preventScroll: true });
            target.scrollIntoView({ block: "center" });
          }}
        >
          Return to your judgment
        </a>
      )}
      {selected && returnToIndex && (
        <StudyIndexLink
          {...returnToIndex}
          className="text-link"
          onReturn={(targetId) => onReturnToIndex(returnToIndex.index, targetId)}
        />
      )}
      {selected ? (
        <>
          <div className={styles.detailHeading}>
            <div>
              <h2>{lane.title}</h2>
              <p>{lane.objective}</p>
              {lane.path && (
                <p className={styles.workspacePath}>
                  <code>{lane.path}</code>
                </p>
              )}
            </div>
            <button
              className="button small"
              type="button"
              onClick={() => {
                onPass(null);
                focusSessionWorkspace();
              }}
            >
              Back to latest workspace
            </button>
          </div>
          <PassReceipt lane={lane} selected={selected} runId={run.id} onPass={onPass} />
        </>
      ) : (
        <>
          {passId && (
            <p className={styles.notice} role="status">
              This saved pass is unavailable.
            </p>
          )}
          <WorkspaceOverview lane={lane} run={run} onPass={onPass} />
        </>
      )}
    </section>
  );
}

const reportViewportId = "study-report-text";

type ReadingPlace = {
  viewportTop: number;
  block?: Element;
  offset: number;
  height: number;
  restoreFocus: boolean;
};

function useReportReading(available: boolean) {
  const [focused, setFocused] = useState(false);
  const reading = available && focused;
  const viewport = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const place = useRef<ReadingPlace>(undefined);

  const change = useCallback((enabled: boolean, restoreFocus = false) => {
    const panel = viewport.current;
    if (panel) {
      const viewportTop = panel.getBoundingClientRect().top;
      const block = Array.from(panel.firstElementChild?.children ?? []).find(
        (element) => element.getBoundingClientRect().bottom > viewportTop,
      );
      const rect = block?.getBoundingClientRect();
      place.current = {
        viewportTop,
        block,
        offset: rect ? viewportTop - rect.top : 0,
        height: rect?.height ?? 0,
        restoreFocus,
      };
    }
    setFocused(enabled);
  }, []);

  useLayoutEffect(() => {
    const panel = viewport.current;
    const saved = place.current;
    place.current = undefined;
    if (!panel || !saved) return;
    const viewportTop = panel.getBoundingClientRect().top;
    if (saved.block && panel.contains(saved.block)) {
      const rect = saved.block.getBoundingClientRect();
      // Preserve the reading position within a paragraph even when lines reflow.
      const offset =
        saved.offset > 0 && saved.height > 0
          ? (saved.offset / saved.height) * rect.height
          : saved.offset;
      panel.scrollTop += rect.top - viewportTop + offset;
    }
    window.scrollBy(0, viewportTop - saved.viewportTop);
    if (saved.restoreFocus) {
      button.current?.focus({ preventScroll: true });
      button.current?.scrollIntoView({ block: "nearest" });
    }
  }, [reading]);

  useEffect(() => {
    if (!reading) return;
    function exit(event: KeyboardEvent) {
      const workspace = button.current?.closest("#current-research-workspace");
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        event.target instanceof Node &&
        workspace?.contains(event.target)
      ) {
        event.preventDefault();
        change(false, true);
      }
    }
    window.addEventListener("keydown", exit);
    return () => window.removeEventListener("keydown", exit);
  }, [reading, change]);

  return { reading, change, viewport, button };
}

function WorkspaceOverview({
  lane,
  run,
  onPass,
}: {
  lane: SessionWorkspace;
  run: RunSnapshot;
  onPass: PassSelection["onPass"];
}) {
  const latest = lane.attempts.at(-1);
  const result = latest?.result ?? lane.attempts.findLast((attempt) => attempt.result)?.result;
  const files = result?.workspace_files ?? [];
  const report = sessionReport(lane, run.status);
  const canFocusReport = !!report?.complete && canPreviewWorkspaceFile(report.file);
  const { reading, change, viewport, button } = useReportReading(canFocusReport);
  const urls = useMemo(
    () => sourceUrls(lane.key === "editor" ? (run.model_attempts ?? []) : lane.attempts),
    [lane.attempts, lane.key, run.model_attempts],
  );
  const active =
    run.status === "running" && (latest?.status === "preparing" || latest?.status === "requesting");
  const assignments = result?.swarm_plan?.leads ?? result?.team_plan?.assignments;
  return (
    <>
      <div className={styles.detailHeading}>
        <div>
          <h2>{report ? (report.complete ? "Research report" : "Report draft") : lane.title}</h2>
          {!reading && <p>{lane.objective}</p>}
          {!reading && lane.path && (
            <p className={styles.workspacePath}>
              <code>{lane.path}</code> · {activityLabel(lane)}
            </p>
          )}
          {!reading && lane.path && lane.profile && (
            <p>
              Model · {lane.profile.model} · {modelSettingLabel(lane.profile.reasoning_effort)}{" "}
              thinking effort · {modelSettingLabel(lane.profile.verbosity)} response detail
            </p>
          )}
        </div>
        {report?.complete && latest && (
          <div className={styles.actions}>
            {canFocusReport && (
              <button
                ref={button}
                className="button small"
                type="button"
                aria-controls={reportViewportId}
                aria-keyshortcuts={reading ? "Escape" : undefined}
                onClick={() => change(!reading)}
              >
                {reading ? (
                  <>
                    Exit reading{" "}
                    <kbd className={styles.readingKey} aria-hidden="true">
                      Esc
                    </kbd>
                  </>
                ) : (
                  "Focus reading"
                )}
              </button>
            )}
            <a
              className="button small primary"
              href={`/?${new URLSearchParams({ view: "reports", fromStudy: run.id, reportAttempt: latest.id })}`}
            >
              Edit in Reports
            </a>
            <a
              className="button small"
              href={`/api/research-sessions/${run.id}/report.zip`}
              download
            >
              Download report and files
            </a>
          </div>
        )}
      </div>
      {active && latest && (
        <div className={styles.live}>
          <strong>
            {latest.result?.workspace_activity?.summary ||
              (latest.status === "preparing" ? "Preparing request" : "Model request in progress")}
          </strong>
          <span>
            Pass {lane.attempts.length} · {latest.model}
            {lane.profile?.reasoning_effort &&
              ` · ${modelSettingLabel(lane.profile.reasoning_effort)} thinking effort`}
            {latest.output_characters > 0 &&
              ` · ${latest.output_characters.toLocaleString()} characters received`}
            {latest.web_actions_completed != null &&
              ` · ${latest.web_actions_completed} web actions completed`}
          </span>
        </div>
      )}
      {lane.state === "Consultation requested" && (
        <p className={styles.empty}>
          The lead’s question is recorded. You can answer once the current work reaches its
          checkpoint.
        </p>
      )}
      {report ? (
        <WorkspaceFilePreview
          file={report.file}
          sources={urls}
          files={files}
          contents={report.complete}
          inspectFigures={report.complete}
          viewport={
            canFocusReport
              ? {
                  id: reportViewportId,
                  role: "region",
                  "aria-label": "Report text",
                  tabIndex: 0,
                  ref: viewport,
                  className: reading
                    ? `${styles.reportViewport} ${styles.focusedReport}`
                    : styles.reportViewport,
                }
              : undefined
          }
        />
      ) : result?.swarm_action ? (
        <SwarmDecision action={result.swarm_action} />
      ) : assignments ? (
        <WorkspaceAssignments assignments={assignments} />
      ) : (
        result?.conclusion &&
        !result.workspace_activity && <SavedFindings result={result} sources={urls} files={files} />
      )}
      {canFocusReport && run.baseline_run_id && (
        <StudyBaselineReport
          key={run.baseline_run_id}
          id={run.baseline_run_id}
          agentId={run.agent_id ?? null}
          selectReport={baselineReport}
        />
      )}
      {!latest && (
        <p className={styles.empty}>
          {lane.key === "editor" && run.status === "paused"
            ? "The editor is waiting for your judgment."
            : "No pass has been recorded in this workspace."}
        </p>
      )}
      {lane.key !== "lead" &&
        lane.attempts.some(
          ({ result: r }) => r?.workspace_activity || r?.workspace_files?.length,
        ) && (
          <details className={styles.receipts} open={!report || undefined} hidden={reading}>
            <summary>Workspace activity and files</summary>
            <ResearchWorkspace attempts={lane.attempts} running={!!active} />
          </details>
        )}
      <RecordedSources urls={urls} hidden={reading} />
      {latest && (
        <details className={styles.receipts} hidden={reading}>
          <summary>Model passes ({lane.attempts.length})</summary>
          <div className={styles.pass}>
            <PassPicker attempts={lane.attempts} passId={null} onPass={onPass} />
          </div>
        </details>
      )}
    </>
  );
}
