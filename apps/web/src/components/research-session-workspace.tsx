import type { components } from "@researchchain/contracts";
import { contentDownloadUrl } from "@/lib/evidence";
import { modelAttemptStatus } from "@/lib/run-inspection";
import type { RunSnapshot } from "@/lib/workflow";
import { ResearchMarkdown } from "./research-markdown";
import { ResearchToolReceipts, researchToolUrls } from "./research-tool-receipts";
import { ResearchWorkspace, WorkspaceFilePreview } from "./research-workspace";
import { formatTime } from "./run-status";
import styles from "./research-session.module.css";

type Attempt = components["schemas"]["ModelAttempt"];
export type SessionWorkspace = {
  key: string;
  title: string;
  objective: string;
  attempts: Attempt[];
};

export function sessionWorkspaces(run: RunSnapshot): SessionWorkspace[] {
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
    },
    ...(plan?.assignments ?? []).map((assignment, index) => ({
      key: `agent-${index + 1}`,
      title: assignment.title,
      objective: assignment.objective,
      attempts: passes(`root/team/agent-${index + 1}`),
    })),
    {
      key: "editor",
      title: "Report editor",
      objective: "Write the report from the team's findings and files.",
      attempts: passes("root/report"),
    },
  ];
}

export function activityLabel(lane: SessionWorkspace) {
  const attempt = lane.attempts.at(-1);
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

function PassReceipts({ attempts }: { attempts: Attempt[] }) {
  return (
    <details className={styles.receipts}>
      <summary>Model passes ({attempts.length})</summary>
      <ol>
        {attempts.map((attempt, index) => (
          <li key={attempt.id}>
            <strong>
              Pass {index + 1} · {modelAttemptStatus(attempt)}
            </strong>
            <span>
              {attempt.returned_model || attempt.model} · {formatTime(attempt.created_at)}
            </span>
            {attempt.result?.next_lead && <p>{attempt.result.next_lead}</p>}
            {attempt.reason && <p>{attempt.reason}</p>}
            <div className={styles.receiptLinks}>
              {attempt.input_artifact_id && (
                <a href={contentDownloadUrl(attempt.input_artifact_id, "request.json")} download>
                  Saved request
                </a>
              )}
              {attempt.response_artifact_id && (
                <a href={contentDownloadUrl(attempt.response_artifact_id, "response.txt")} download>
                  Saved response
                </a>
              )}
            </div>
            {attempt.result && <ResearchToolReceipts result={attempt.result} />}
          </li>
        ))}
      </ol>
    </details>
  );
}

export function SessionWorkspaceDetail({
  lane,
  run,
}: {
  lane: SessionWorkspace;
  run: RunSnapshot;
}) {
  const latest = lane.attempts.at(-1);
  const result = latest?.result;
  const files = result?.workspace_files ?? [];
  const report =
    lane.key === "editor"
      ? (files.find((file) => file.name === "report.md") ??
        files.find((file) => file.name.toLowerCase().endsWith(".md")))
      : undefined;
  const urls = sourceUrls(lane.key === "editor" ? (run.model_attempts ?? []) : lane.attempts);
  const active =
    run.status === "running" && (latest?.status === "preparing" || latest?.status === "requesting");
  const plan = result?.team_plan;
  return (
    <section className={styles.detail} aria-label={`${lane.title} workspace`}>
      <div className={styles.detailHeading}>
        <div>
          <h2>{report ? "Research report" : lane.title}</h2>
          <p>{lane.objective}</p>
        </div>
        {report && run.status === "completed" && (
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
            {latest.output_characters > 0 &&
              ` · ${latest.output_characters.toLocaleString()} characters received`}
            {latest.web_actions_completed != null &&
              ` · ${latest.web_actions_completed} web actions completed`}
          </span>
        </div>
      )}
      {report ? (
        <WorkspaceFilePreview file={report} sources={urls} files={files} />
      ) : plan ? (
        <ol className={styles.assignments}>
          {plan.assignments.map((assignment, i) => (
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
      {!!lane.attempts.length && <PassReceipts attempts={lane.attempts} />}
    </section>
  );
}
