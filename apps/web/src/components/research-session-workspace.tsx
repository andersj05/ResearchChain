import type { components } from "@researchchain/contracts";
import { useState } from "react";
import { contentDownloadUrl } from "@/lib/evidence";
import { modelSettingLabel, resolveModelProfile } from "@/lib/model-settings";
import { modelAttemptStatus } from "@/lib/run-inspection";
import { sessionSwarm, swarmWorkspaces, type SessionWorkspace } from "@/lib/swarm-workspaces";
import type { RunSnapshot } from "@/lib/workflow";
import { ResearchMarkdown } from "./research-markdown";
import { ResearchToolReceipts, researchToolUrls } from "./research-tool-receipts";
import { ResearchWorkspace, WorkspaceFilePreview } from "./research-workspace";
import { formatTime } from "./run-status";
import styles from "./research-session.module.css";

type Attempt = components["schemas"]["ModelAttempt"];

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
      attempts: director ? [director] : [],
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

type Result = NonNullable<Attempt["result"]>;
function SwarmDecision({ action }: { action: NonNullable<Result["swarm_action"]> }) {
  if (action.action === "delegate")
    return (
      <div className={styles.findings}>
        <h3>Delegated research</h3>
        <p>{action.rationale}</p>
        <ol className={styles.assignments}>
          {action.assignments.map((item) => (
            <li key={item.title}>
              <strong>{item.title}</strong>
              <p>{item.objective}</p>
            </li>
          ))}
        </ol>
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

type PassSelection = { passId: string | null; onPass: (id: string) => void };

function PassReceipts({
  attempts,
  profile,
  passId,
  onPass,
}: Pick<SessionWorkspace, "attempts" | "profile"> & PassSelection) {
  const selected = attempts.find((attempt) => attempt.id === passId) ?? attempts.at(-1)!;
  const result = selected.result;
  const activity = result?.workspace_activity;
  return (
    <details className={styles.receipts} open={!!passId || undefined}>
      <summary>Model passes ({attempts.length})</summary>
      <div className={styles.pass}>
        <label>
          Inspect model pass
          <select value={selected.id} onChange={(event) => onPass(event.target.value)}>
            {attempts.map((attempt, index) => (
              <option key={attempt.id} value={attempt.id}>
                Pass {index + 1} · {modelAttemptStatus(attempt)}
              </option>
            ))}
          </select>
        </label>
        <span>
          {selected.model}
          {selected.returned_model &&
            selected.returned_model !== selected.model &&
            ` · Returned ${selected.returned_model}`}{" "}
          · Started {formatTime(selected.created_at)}
          {selected.finished_at && ` · Finished ${formatTime(selected.finished_at)}`}
        </span>
        {profile && (
          <span>
            Thinking effort · {modelSettingLabel(profile.reasoning_effort)} · Response detail ·{" "}
            {modelSettingLabel(profile.verbosity)}
          </span>
        )}
        {(selected.input_tokens != null || selected.output_tokens != null) && (
          <span>
            Tokens in {selected.input_tokens?.toLocaleString() ?? "unreported"} · out{" "}
            {selected.output_tokens?.toLocaleString() ?? "unreported"}
          </span>
        )}
        {activity && (
          <p>
            Python {activity.status} · {activity.summary}
          </p>
        )}
        {result?.next_lead && !activity && <p>{result.next_lead}</p>}
        {result?.conclusion && !activity && (
          <ResearchMarkdown
            text={result.conclusion}
            sources={sourceUrls([selected])}
            files={result.workspace_files ?? []}
          />
        )}
        {selected.reason && <p>{selected.reason}</p>}
        {result?.swarm_action && <SwarmDecision action={result.swarm_action} />}
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
        </div>
        {result && <ResearchToolReceipts result={result} />}
      </div>
    </details>
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
    <details className={styles.activity}>
      <summary>
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
                  document
                    .getElementById("research-workspaces")
                    ?.scrollIntoView({ block: "start" });
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
}: {
  lane: SessionWorkspace;
  run: RunSnapshot;
} & PassSelection) {
  const latest = lane.attempts.at(-1);
  const result = latest?.result ?? lane.attempts.findLast((attempt) => attempt.result)?.result;
  const files = result?.workspace_files ?? [];
  const finalReport =
    lane.key === "editor" &&
    run.status === "completed" &&
    latest?.status === "completed" &&
    !!latest.result &&
    !latest.result.workspace_activity &&
    !latest.result.next_lead;
  const report =
    lane.key === "editor"
      ? (files.find((file) => file.name === "report.md") ??
        (finalReport && files.find((file) => file.name.toLowerCase().endsWith(".md"))))
      : undefined;
  const urls = sourceUrls(lane.key === "editor" ? (run.model_attempts ?? []) : lane.attempts);
  const active =
    run.status === "running" && (latest?.status === "preparing" || latest?.status === "requesting");
  const assignments = result?.swarm_plan?.leads ?? result?.team_plan?.assignments;
  return (
    <section
      id="current-research-workspace"
      className={styles.detail}
      aria-label={`${lane.title} workspace`}
    >
      <div className={styles.detailHeading}>
        <div>
          <h2>{report ? (finalReport ? "Research report" : "Report draft") : lane.title}</h2>
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
        {report && finalReport && (
          <a className="button small" href={`/api/research-sessions/${run.id}/report.zip`} download>
            Download report and files
          </a>
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
        <WorkspaceFilePreview file={report} sources={urls} files={files} />
      ) : result?.swarm_action ? (
        <SwarmDecision action={result.swarm_action} />
      ) : assignments ? (
        <ol className={styles.assignments}>
          {assignments.map((assignment, i) => (
            <li key={i}>
              <strong>{assignment.title}</strong>
              <p>{assignment.objective}</p>
            </li>
          ))}
        </ol>
      ) : (
        result?.conclusion &&
        !result.workspace_activity && (
          <div className={styles.findings}>
            <ResearchMarkdown text={result.conclusion} sources={urls} files={files} />
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
        )
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
      {urls.size > 0 && (
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
      )}
      {!!lane.attempts.length && (
        <PassReceipts
          attempts={lane.attempts}
          profile={lane.profile}
          passId={passId}
          onPass={onPass}
        />
      )}
    </section>
  );
}
