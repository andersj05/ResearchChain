"use client";

import "./run-workspace.css";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ResearchManifest } from "./research-results";
import { RunCanvas } from "./canvas/run-canvas";
import { RunStepInspector, type ResumeReview } from "./run-step-inspector";
import { RunModelActivity, type ModelActivityFilter } from "./run-model-activity";
import { RunDecisions, type FeedbackBriefDraft } from "./run-decisions";
import { RunFiles, savedRunFiles } from "./run-files";
import { RunOutputs, type OutputFilter } from "./run-outputs";
import { RunIterationComparison } from "./run-iteration-comparison";
import { RunComparison } from "./run-comparison";
import { formatTime, RunStatus } from "./run-status";
import {
  attemptPath,
  bookmarkedReview,
  graphLocation,
  linkedIterationComparison,
  pendingReviews,
  preferredPath,
  reviewPath,
  runInspectionUrl,
  stepStates,
  type IterationComparison,
  type ReviewBookmark,
} from "@/lib/run-inspection";
import { PinnedEvidence } from "@/components/pinned-evidence";
import { useOwner } from "@/components/access-context";
import { ownerStoragePrefix } from "@/lib/access";
import { pruneReviewDrafts, readReviewDrafts, storeReviewDrafts } from "@/lib/run-review-drafts";
import { Button } from "@ui-sdk/react/button";
import type { RecentRunSummary, RunSnapshot } from "@/lib/workflow";
import { Activity, ArrowRight, ChevronRight, RotateCw } from "lucide-react";

export type ReviewFocus = { runId: string; path: string };
type RunView = "step" | "outputs" | "activity" | "decisions" | "files" | "context" | "comparison";

function runLinkTarget(run: RunSnapshot) {
  if (typeof window === "undefined") return {};
  const params = new URL(window.location.href).searchParams;
  if (params.get("run")?.toLowerCase() !== run.id) return {};
  if (params.has("review") || params.has("checkpoint")) {
    const bookmark = {
      checkpointId: params.get("checkpoint") ?? "",
      interruptId: params.get("review") ?? "",
    };
    const review = bookmarkedReview(run, bookmark);
    return { reviewBookmark: bookmark, path: review && reviewPath(review) };
  }
  const attemptId = params.get("attempt")?.toLowerCase();
  const attempt = attemptId && run.model_attempts?.find((item) => item.id === attemptId);
  if (attempt) return { attemptId: attempt.id, path: attemptPath(attempt) };
  const id = params.get("compare")?.toLowerCase();
  if (id && id !== run.id && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)) {
    return { comparison: id };
  }
  const iterations = params.get("iterations");
  if (iterations !== null)
    return { iterations: linkedIterationComparison(run, iterations) ?? null };
  return {};
}

type Actions = {
  busy: boolean;
  recentRuns: RecentRunSummary[];
  reviewFocus?: ReviewFocus;
  onResume: ResumeReview;
  onRecover: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onCancel: () => Promise<void>;
  onOpenRevision: () => Promise<void>;
  onIterate: (brief?: string, stepPath?: string) => Promise<void>;
};

export function RunInspector({
  run,
  reviewFocus,
  ...actions
}: Actions & { run: RunSnapshot | null }) {
  const focus = reviewFocus?.runId === run?.id ? reviewFocus : undefined;
  return (
    <section className="run-inspector run-workspace" aria-label="Run inspector">
      {run ? (
        <RunWorkspace key={run.id} run={run} reviewFocus={focus} {...actions} />
      ) : (
        <div className="empty-state">
          <h2>No run selected</h2>
          <p>Run a workflow or open a recent run to inspect its progress.</p>
        </div>
      )}
    </section>
  );
}

function RunWorkspace({
  run,
  reviewFocus,
  recentRuns,
  busy,
  onResume,
  onRecover,
  onRefresh,
  onCancel,
  onOpenRevision,
  onIterate,
}: Actions & { run: RunSnapshot }) {
  const { owner } = useOwner();
  const mapPreference = `${ownerStoragePrefix(owner)}.run-map-visible`;
  const reviewDraftKey = `${ownerStoragePrefix(owner)}.review-drafts.${run.id}`;
  const [link] = useState(() => runLinkTarget(run));
  const [reviewBookmark, setReviewBookmark] = useState<ReviewBookmark | undefined>(
    reviewFocus ? undefined : link.reviewBookmark,
  );
  const [comparison, setComparison] = useState(link.comparison);
  const [iterationComparison, setIterationComparison] = useState<
    IterationComparison | null | undefined
  >(reviewFocus ? undefined : link.iterations);
  const [lastFocus, setLastFocus] = useState(reviewFocus);
  const [manual, setManual] = useState<string | null>(reviewFocus?.path ?? link.path ?? null);
  const [selectedView, setView] = useState<RunView>(
    reviewFocus
      ? "step"
      : comparison
        ? "comparison"
        : link.iterations !== undefined
          ? "outputs"
          : "step",
  );
  const staleReviewLink = reviewBookmark && !bookmarkedReview(run, reviewBookmark);
  const view = staleReviewLink ? "decisions" : selectedView;
  const navigation = useRef(0);
  const [showStepMap, setShowStepMap] = useState(() => {
    try {
      return localStorage.getItem(mapPreference) !== "false";
    } catch {
      return true;
    }
  });
  const [showOutputMap, setShowOutputMap] = useState(false);
  const showGraph = view === "outputs" ? showOutputMap : showStepMap;
  const [attemptId, setAttemptId] = useState(reviewFocus ? undefined : link.attemptId);
  const [feedback, setFeedback] = useState(() => readReviewDrafts(reviewDraftKey));
  const [feedbackBrief, setFeedbackBrief] = useState<FeedbackBriefDraft | null>(null);
  const [activityFilter, setActivityFilter] = useState<ModelActivityFilter>({
    query: "",
    fitFiltered: false,
  });
  const [fileQuery, setFileQuery] = useState("");
  const [outputFilter, setOutputFilter] = useState<OutputFilter>({ query: "", kind: "" });
  const pendingFeedback = pruneReviewDrafts(run, feedback);
  if (pendingFeedback !== feedback) setFeedback(pendingFeedback);
  const reviewDrafts = JSON.stringify(pendingFeedback);
  useEffect(() => {
    storeReviewDrafts(reviewDraftKey, reviewDrafts);
  }, [reviewDraftKey, reviewDrafts]);
  if (reviewFocus !== lastFocus) {
    setLastFocus(reviewFocus);
    if (reviewFocus) {
      setReviewBookmark(undefined);
      setManual(reviewFocus.path);
      setView("step");
      setAttemptId(undefined);
      setIterationComparison(undefined);
    }
  }
  const states = stepStates(run);
  const current = preferredPath(run);
  const path = manual ?? current;
  const readingPane = useRef<HTMLDivElement>(null);
  const focusOnInspect = useRef(false);
  const comparingIterations = Boolean(iterationComparison);
  useLayoutEffect(() => {
    const pane = readingPane.current;
    if (!pane) return;
    pane.scrollTop = 0;
    if (focusOnInspect.current) {
      focusOnInspect.current = false;
      pane.focus();
    }
  }, [path, view, attemptId, comparingIterations]);
  useLayoutEffect(() => {
    if (reviewFocus) readingPane.current?.focus();
  }, [reviewFocus]);
  const { node, graph, parents, prefix } = graphLocation(run, path);
  const reviews = pendingReviews(run);
  const files = savedRunFiles(run);
  const clearReviewBookmark = () => {
    setReviewBookmark(undefined);
    const url = new URL(window.location.href);
    if (url.searchParams.has("review") || url.searchParams.has("checkpoint")) {
      url.searchParams.delete("review");
      url.searchParams.delete("checkpoint");
      window.history.replaceState(null, "", url);
    }
  };
  const clearIterationLink = () => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("iterations")) {
      url.searchParams.delete("iterations");
      window.history.replaceState(null, "", url);
    }
  };
  const changeView = (next: RunView) => {
    navigation.current += 1;
    clearReviewBookmark();
    if (next !== "outputs") {
      clearIterationLink();
      setIterationComparison(undefined);
    }
    setView(next);
  };
  const select = (value: string, id?: string) => {
    setManual(value);
    setAttemptId(id);
    changeView("step");
  };
  const selectComparison = (id: string | undefined) => {
    setComparison(id);
    const url = id
      ? runInspectionUrl(window.location.href, run.id, "compare", id)
      : new URL(window.location.href);
    if (!id) {
      url.searchParams.delete("compare");
      url.searchParams.delete("passes");
    }
    window.history.replaceState(null, "", url);
  };
  const inspectFromPanel = (step: string, id?: string) => {
    focusOnInspect.current = true;
    select(step, id);
  };
  const follow = () => {
    setManual(null);
    setAttemptId(undefined);
    changeView("step");
  };
  const toggleGraph = () => {
    if (view === "outputs") {
      setShowOutputMap(!showOutputMap);
      return;
    }
    setShowStepMap(!showStepMap);
    try {
      localStorage.setItem(mapPreference, String(!showStepMap));
    } catch {
      // The map remains usable if browser storage is disabled.
    }
  };
  const limits = run.research_manifest?.settings.limits ?? run.workflow.research?.limits;
  const tokens = (run.usage?.input_tokens ?? 0) + (run.usage?.output_tokens ?? 0);
  const tokenLimit = limits?.max_total_tokens;
  const live = ["paused", "running", "queued", "interrupted"].includes(run.status);
  const currentStatus = states.get(current);
  const reviewingHistory = current !== path || view !== "step" || Boolean(attemptId);
  const showActivity = reviewingHistory && (live || Boolean(run.stop_reason));
  return (
    <>
      <header className="run-head">
        <div className="run-title">
          <h2>{run.workflow_name}</h2>
          <RunStatus status={run.status} announce />
        </div>
        <div className="run-meta">
          <span className="code-label">{run.id.slice(0, 8)}</span>
          <span>Revision {run.revision_number}</span>
          <span aria-label="Run agent">{run.agent_name ?? "Unassigned workflow"}</span>
          <time dateTime={run.created_at}>{formatTime(run.created_at)}</time>
        </div>
        <div className="actions run-actions">
          <Button className="button small" disabled={busy} onClick={() => onIterate()}>
            Iterate from this run
            <ArrowRight size={14} aria-hidden />
          </Button>
          {run.baseline_run_id && (
            <button
              className="button small"
              type="button"
              onClick={() => {
                selectComparison(run.baseline_run_id ?? undefined);
                changeView("comparison");
              }}
            >
              Compare with baseline
            </button>
          )}
          {live && (
            <Button className="button small" onClick={onCancel}>
              Cancel run
            </Button>
          )}
          <Button
            className="button small icon-button"
            disabled={busy}
            onClick={onRefresh}
            aria-label="Refresh run"
            title="Refresh run"
          >
            <RotateCw size={14} aria-hidden />
          </Button>
        </div>
      </header>
      {run.status === "queued" && (
        <div className="run-notice" role="status">
          <strong>Waiting to start</strong>
          <p>Your run is saved and will start when capacity is available.</p>
        </div>
      )}
      {run.stop_reason && (
        <p className="run-notice stop-reason" role="status">
          {run.stop_reason}
        </p>
      )}
      {run.status === "interrupted" && (
        <div className="run-notice">
          <div>
            <strong>Continue from saved progress</strong>
            <p>Recovery continues accepted work from the last confirmed checkpoint.</p>
          </div>
          <Button className="button primary" disabled={busy} onClick={onRecover}>
            Recover run
          </Button>
        </div>
      )}
      <div className="run-graph-shell">
        <div className="run-graph-line">
          <h3>Workflow progress</h3>
          <div className="run-metrics" aria-label="Run usage">
            <span>{run.events.length.toLocaleString()} recorded steps</span>
            {limits && (
              <>
                <span>
                  {(run.model_attempts?.length ?? 0).toLocaleString()} / {limits.max_model_calls}{" "}
                  model attempts
                </span>
                <span>
                  {tokens.toLocaleString()}
                  {typeof tokenLimit === "number" ? ` / ${tokenLimit.toLocaleString()}` : ""} tokens
                  {tokenLimit === "as_needed" ? " · As needed" : ""}
                  {run.usage?.usage_complete === false ? " (incomplete)" : ""}
                </span>
              </>
            )}
          </div>
          <button
            className="button small"
            type="button"
            aria-expanded={showGraph}
            onClick={toggleGraph}
          >
            {showGraph ? "Hide workflow map" : "Show workflow map"}
          </button>
        </div>
        <div aria-live="polite" aria-atomic="true">
          {currentStatus && (
            <div
              className={showActivity ? "run-current-step" : "sr-only"}
              role={showActivity ? "group" : undefined}
              aria-label={showActivity ? "Latest workflow activity" : undefined}
            >
              {showActivity && <span className="muted">Latest activity</span>}
              <strong>{graphLocation(run, current).node.label}</strong>
              <span className="step-status" data-status={currentStatus}>
                {currentStatus}
              </span>
            </div>
          )}
        </div>
        {parents.length > 0 && (
          <nav className="run-graph-path" aria-label="Nested graph path">
            {parents.map((parent) => (
              <span key={parent.path}>
                <button type="button" className="text-link" onClick={() => select(parent.path)}>
                  {parent.label}
                </button>
                <ChevronRight size={13} aria-hidden />
              </span>
            ))}
            <span>
              {graph.name}
              {prefix.split("/").at(-1)?.startsWith("iteration-") &&
                ` · ${prefix.split("/").at(-1)!.replace("-", " ")}`}
            </span>
          </nav>
        )}
        {showGraph && (
          <RunCanvas
            graph={graph}
            prefix={prefix}
            selected={node.id}
            states={states}
            onSelect={select}
          />
        )}
        <div className="run-map-navigation">
          <label>
            <span>Inspect step</span>
            <select value={path} onChange={(e) => select(e.target.value)}>
              {graph.nodes.map((item) => {
                const p = `${prefix}/${item.id}`;
                return (
                  <option key={item.id} value={p}>
                    {item.label} · {states.get(p) ?? "Not reached"}
                  </option>
                );
              })}
            </select>
          </label>
          {(manual || view !== "step") && (
            <button className="button small follow-run" type="button" onClick={follow}>
              <Activity size={14} aria-hidden />
              {reviews.length ? "Return to review" : live ? "Follow run" : "Latest activity"}
            </button>
          )}
          {reviews.length > 1 && (
            <label>
              <span>Pending reviews</span>
              <select
                aria-label="Pending reviews"
                value={reviews.some((r) => reviewPath(r) === path) ? path : ""}
                onChange={(e) => select(e.target.value)}
              >
                <option value="" disabled>
                  Choose review
                </option>
                {reviews.map((review) => (
                  <option key={review.interrupt_id} value={reviewPath(review)}>
                    {graphLocation(run, reviewPath(review)).node.label} · {reviewPath(review)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
      <div className="run-section-switch" role="group" aria-label="Run inspection view">
        <button type="button" aria-pressed={view === "step"} onClick={() => changeView("step")}>
          Step details
        </button>
        <button
          type="button"
          aria-pressed={view === "outputs"}
          onClick={() => changeView("outputs")}
        >
          Outputs
        </button>
        <button
          type="button"
          aria-pressed={view === "activity"}
          onClick={() => changeView("activity")}
        >
          Model activity
        </button>
        <button
          type="button"
          aria-pressed={view === "decisions"}
          onClick={() => changeView("decisions")}
        >
          Decisions{reviews.length > 0 && ` (${reviews.length})`}
        </button>
        {files.length > 0 && (
          <button type="button" aria-pressed={view === "files"} onClick={() => changeView("files")}>
            Files ({files.length})
          </button>
        )}
        <button
          type="button"
          aria-pressed={view === "context"}
          onClick={() => changeView("context")}
        >
          Run context
        </button>
        <button
          type="button"
          aria-pressed={view === "comparison"}
          onClick={() => changeView("comparison")}
        >
          Compare runs
        </button>
      </div>
      <div className="run-reading-pane" ref={readingPane} tabIndex={-1}>
        {staleReviewLink && <p role="status">This review link is out of date.</p>}
        {view === "outputs" &&
          (iterationComparison ? (
            <RunIterationComparison
              run={run}
              selection={iterationComparison}
              onChange={(selection) => {
                clearIterationLink();
                setIterationComparison(selection);
              }}
              onBack={() => {
                focusOnInspect.current = true;
                clearIterationLink();
                setIterationComparison(undefined);
              }}
            />
          ) : (
            <>
              {iterationComparison === null && (
                <p role="status">This saved iteration comparison is unavailable.</p>
              )}
              <RunOutputs
                run={run}
                inspect={inspectFromPanel}
                filter={outputFilter}
                onFilterChange={setOutputFilter}
                onCompare={(selection) => {
                  focusOnInspect.current = true;
                  clearIterationLink();
                  changeView("outputs");
                  setIterationComparison(selection);
                }}
              />
            </>
          ))}
        {view === "activity" && (
          <RunModelActivity
            run={run}
            inspect={inspectFromPanel}
            filter={activityFilter}
            onFilterChange={setActivityFilter}
          />
        )}
        {view === "decisions" && (
          <RunDecisions
            run={run}
            busy={busy}
            inspect={inspectFromPanel}
            iterate={onIterate}
            feedbackDraft={feedbackBrief}
            onFeedbackDraftChange={setFeedbackBrief}
          />
        )}
        {view === "files" && (
          <RunFiles
            files={files}
            run={run}
            inspect={inspectFromPanel}
            filter={{ query: fileQuery, onChange: setFileQuery }}
          />
        )}
        {view === "comparison" && (
          <RunComparison
            run={run}
            recentRuns={recentRuns}
            selected={comparison}
            onSelect={selectComparison}
          />
        )}
        {view === "context" && (
          <div className="run-context-panel">
            <details className="run-brief" open>
              <summary>Research brief</summary>
              <p>{run.brief}</p>
            </details>
            <PinnedEvidence
              ids={run.evidence_ids ?? []}
              snapshots={run.research_manifest?.evidence}
            />
            <ResearchManifest run={run} />
            {!run.research_manifest && (
              <p className="field-hint" aria-label="Run model">
                {run.workflow.research
                  ? "Model manifest is not available yet."
                  : "No model calls. This run uses local steps and human reviews."}
              </p>
            )}
            <details className="run-details">
              <summary>Pinned workflow &amp; run details</summary>
              <p className="muted">
                Editor changes apply to future runs. This run keeps revision {run.revision_number}.
              </p>
              <Button className="button" disabled={busy} onClick={onOpenRevision}>
                Open this revision
              </Button>
              <dl>
                <dt>Run ID</dt>
                <dd>{run.id}</dd>
                <dt>Checkpoint</dt>
                <dd>{run.checkpoint_id ?? "Not started"}</dd>
                <dt>Executor</dt>
                <dd>{run.compiler_version}</dd>
                <dt>Executed steps</dt>
                <dd>{run.usage?.node_executions ?? run.events.length}</dd>
                <dt>Active time</dt>
                <dd>{(run.usage?.active_seconds ?? 0).toFixed(2)} seconds</dd>
                <dt>Artifact references</dt>
                <dd>{run.artifacts.length}</dd>
              </dl>
            </details>
          </div>
        )}
        {view === "step" && (
          <RunStepInspector
            run={run}
            path={path}
            attemptId={attemptId}
            states={states}
            busy={busy}
            feedback={pendingFeedback}
            changeFeedback={(id, value) => setFeedback((prev) => ({ ...prev, [id]: value }))}
            onIterateStep={() => onIterate(undefined, path)}
            onModelActivity={() => {
              focusOnInspect.current = true;
              setActivityFilter((previous) => ({ ...previous, query: "", step: path }));
              changeView("activity");
            }}
            onResume={async (...args) => {
              const submittedFrom = navigation.current;
              clearReviewBookmark();
              await onResume(...args);
              if (navigation.current === submittedFrom) follow();
            }}
            select={inspectFromPanel}
          />
        )}
      </div>
    </>
  );
}
