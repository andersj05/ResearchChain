import type { components } from "@researchchain/contracts";
import { useState } from "react";
import { contentDownloadUrl } from "@/lib/evidence";
import { modelSettingLabel, resolveModelProfile } from "@/lib/model-settings";
import { modelAttemptStatus } from "@/lib/run-inspection";
import { sessionSwarm, swarmWorkspaces, type SessionWorkspace } from "@/lib/swarm-workspaces";
import type { RunSnapshot } from "@/lib/workflow";
import { ResearchMarkdown } from "./research-markdown";
import { ResearchToolReceipts, researchToolUrls } from "./research-tool-receipts";
import { ResearchWorkspace, WorkspaceFilePreview, WorkspaceFiles } from "./research-workspace";
import { formatTime } from "./run-status";
import styles from "./research-session.module.css";

type Attempt = components["schemas"]["ModelAttempt"];

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
  function passes(path: string) {
    return attempts.filter(
      (item) => item.path === path || item.path.startsWith(path + "/analyst-pass-"),
    );
  }
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
      attempts: passes(`root/team/agent-${index + 1}`),
      profile: profiles?.researcher,
    })),
    {
      key: "editor",
      title: "Report editor",
      objective: "Write the report from the team's findings and files.",
      attempts: passes("root/report"),
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

export function sessionReport(lane: SessionWorkspace, status: RunSnapshot["status"]) {
  if (lane.key !== "editor") return;
  const latest = lane.attempts.at(-1);
  const result = latest?.result ?? lane.attempts.findLast((attempt) => attempt.result)?.result;
  const complete =
    status === "completed" &&
    latest?.status === "completed" &&
    !!latest.result &&
    !latest.result.workspace_activity &&
    !latest.result.next_lead;
  const files = result?.workspace_files ?? [];
  const file =
    files.find((item) => item.name === "report.md") ??
    (complete ? files.find((item) => item.name.toLowerCase().endsWith(".md")) : undefined);
  if (file) return { file, complete };
}

type Result = NonNullable<Attempt["result"]>;
type WorkspaceFile = components["schemas"]["WorkspaceFile"];

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

function RecordedSources({ urls }: { urls: Set<string> }) {
  if (!urls.size) return null;
  return (
    <details className={styles.receipts}>
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
        <a href={`/?${new URLSearchParams({ view: "runs", run: runId, attempt: selected.id })}`}>
          Inspect pass in Runs
        </a>
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

export function SessionActivity({
  lanes,
  select,
}: {
  lanes: SessionWorkspace[];
  select: (key: string, id: string) => void;
}) {
  const [limit, setLimit] = useState(12);
  const entries = lanes
    .flatMap((lane) =>
      lane.attempts.map((attempt, index) => ({
        lane,
        attempt,
        number: index + 1,
        time: attempt.finished_at ?? attempt.created_at,
      })),
    )
    .sort((left, right) => Date.parse(right.time) - Date.parse(left.time));
  if (!entries.length) return null;
  return (
    <details id="research-activity" className={styles.activity}>
      <summary id="research-activity-heading">
        Activity log · {entries.length} recorded {entries.length === 1 ? "pass" : "passes"}
      </summary>
      <ol>
        {entries.slice(0, limit).map(({ lane, attempt, number, time }) => {
          const result = attempt.result;
          const summary =
            result?.workspace_activity?.summary ||
            (result?.swarm_action?.action === "ask_expert" &&
              result.swarm_action.consultation.question) ||
            (result?.swarm_action?.action === "delegate" && result.swarm_action.rationale) ||
            (result?.swarm_action?.action === "finish" && result.swarm_action.findings) ||
            result?.next_lead ||
            result?.revision_summary ||
            attempt.reason ||
            modelAttemptStatus(attempt);
          return (
            <li key={attempt.id}>
              <button
                onClick={() => {
                  select(lane.key, attempt.id);
                  focusSessionWorkspace();
                }}
              >
                <time dateTime={time}>{new Date(time).toLocaleTimeString()}</time>
                <span>
                  <strong>{lane.title}</strong> · Pass {number}
                  <small>{summary}</small>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {entries.length > limit && (
        <button className="text-link" onClick={() => setLimit((value) => value + 12)}>
          Show earlier passes
        </button>
      )}
    </details>
  );
}

export function SessionWorkspaceDetail({
  lane,
  run,
  passId,
  onPass,
  returnToReview,
}: {
  lane: SessionWorkspace;
  run: RunSnapshot;
  returnToReview?: { id: string; title: string };
} & PassSelection) {
  const selected = lane.attempts.find((attempt) => attempt.id === passId);
  return (
    <section
      id="current-research-workspace"
      className={styles.detail}
      aria-label={`${lane.title} workspace`}
      tabIndex={-1}
    >
      {returnToReview && (
        <a className="text-link" href={`#consultation-${returnToReview.id}-answer`}>
          Return to {returnToReview.title}’s question
        </a>
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
  const urls = sourceUrls(lane.key === "editor" ? (run.model_attempts ?? []) : lane.attempts);
  const active =
    run.status === "running" && (latest?.status === "preparing" || latest?.status === "requesting");
  const assignments = result?.swarm_plan?.leads ?? result?.team_plan?.assignments;
  return (
    <>
      <div className={styles.detailHeading}>
        <div>
          <h2>{report ? (report.complete ? "Research report" : "Report draft") : lane.title}</h2>
          <p>{lane.objective}</p>
          {lane.path && (
            <p className={styles.workspacePath}>
              <code>{lane.path}</code> · {activityLabel(lane)}
            </p>
          )}
          {lane.path && lane.profile && (
            <p>
              Model · {lane.profile.model} · {modelSettingLabel(lane.profile.reasoning_effort)}{" "}
              thinking effort · {modelSettingLabel(lane.profile.verbosity)} response detail
            </p>
          )}
        </div>
        {report?.complete && latest && (
          <div className={styles.actions}>
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
        <WorkspaceFilePreview file={report.file} sources={urls} files={files} />
      ) : result?.swarm_action ? (
        <SwarmDecision action={result.swarm_action} />
      ) : assignments ? (
        <WorkspaceAssignments assignments={assignments} />
      ) : (
        result?.conclusion &&
        !result.workspace_activity && <SavedFindings result={result} sources={urls} files={files} />
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
          <details className={styles.receipts} open={!report || undefined}>
            <summary>Workspace activity and files</summary>
            <ResearchWorkspace attempts={lane.attempts} running={!!active} />
          </details>
        )}
      <RecordedSources urls={urls} />
      {latest && (
        <details className={styles.receipts}>
          <summary>Model passes ({lane.attempts.length})</summary>
          <div className={styles.pass}>
            <PassPicker attempts={lane.attempts} passId={null} onPass={onPass} />
          </div>
        </details>
      )}
    </>
  );
}
