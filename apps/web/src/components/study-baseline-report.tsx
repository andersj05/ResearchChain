import { useRef, useState } from "react";
import type { components } from "@researchchain/contracts";
import { contentDownloadUrl } from "@/lib/evidence";
import { api, ApiError, type RunSnapshot } from "@/lib/workflow";
import { canPreviewWorkspaceFile, WorkspaceFilePreview } from "./research-workspace";
import { formatTime } from "./run-status";
import styles from "./research-session.module.css";

type WorkspaceFile = components["schemas"]["WorkspaceFile"];
type BaselineContents = { file: WorkspaceFile; files: WorkspaceFile[]; sources: Set<string> };
type BaselineState =
  | { status: "loading" | "unavailable" | "error" }
  | { status: "no-report"; canChange: boolean }
  | {
      status: "ready";
      contents: BaselineContents;
      title: string;
      createdAt: string;
      revealed: boolean;
    };

export function StudyBaselineReport({
  id,
  agentId,
  selectReport,
}: {
  id: string;
  agentId: string | null;
  selectReport: (run: RunSnapshot) => BaselineContents | undefined;
}) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const [state, setState] = useState<BaselineState>();

  async function load() {
    setState({ status: "loading" });
    try {
      const run = await api<RunSnapshot>(`runs/${encodeURIComponent(id)}`);
      if (
        run.id !== id ||
        (run.agent_id ?? null) !== agentId ||
        run.research_manifest?.tool_config?.session !== "brief-led-1"
      ) {
        setState({ status: "unavailable" });
        return;
      }
      const contents = selectReport(run);
      if (!contents) {
        setState({ status: "no-report", canChange: run.status !== "completed" });
        return;
      }
      setState({
        status: "ready",
        contents,
        title: run.study_title?.trim() || "Baseline study",
        createdAt: run.created_at,
        revealed: disclosure.current?.open === true,
      });
    } catch (cause) {
      const unavailable =
        cause instanceof ApiError && (cause.status === 403 || cause.status === 404);
      setState({ status: unavailable ? "unavailable" : "error" });
    }
  }

  return (
    <details
      className={styles.receipts}
      ref={disclosure}
      onToggle={(event) => {
        if (!event.currentTarget.open) return;
        if (!state || (state.status === "no-report" && state.canChange)) void load();
        if (state?.status === "ready" && !state.revealed) setState({ ...state, revealed: true });
      }}
    >
      <summary>Baseline report</summary>
      <div className={styles.baselineReport}>
        {state?.status === "loading" && <p role="status">Checking the baseline study…</p>}
        {state?.status === "no-report" && (
          <p role="status">The baseline study has no completed report.</p>
        )}
        {state?.status === "unavailable" && <p role="status">The baseline study is unavailable.</p>}
        {state?.status === "error" && (
          <p role="alert">
            The baseline study could not be loaded.{" "}
            <button type="button" className="text-link" onClick={() => void load()}>
              Retry
            </button>
          </p>
        )}
        {state?.status === "ready" && state.revealed && (
          <>
            <header>
              <h3>{state.title}</h3>
              <time dateTime={state.createdAt}>{formatTime(state.createdAt, true)}</time>
            </header>
            {canPreviewWorkspaceFile(state.contents.file) ? (
              <WorkspaceFilePreview
                {...state.contents}
                inspectFigures
                viewport={{ role: "region", "aria-label": "Baseline report text", tabIndex: 0 }}
              />
            ) : (
              <a
                href={contentDownloadUrl(state.contents.file.artifact_id, state.contents.file.name)}
                download={state.contents.file.name}
              >
                Download baseline report
              </a>
            )}
          </>
        )}
      </div>
    </details>
  );
}
