import { useState } from "react";
import {
  attemptPath,
  graphLocation,
  runStepLabel,
  type ComparisonPasses,
} from "@/lib/run-inspection";
import type { RunSnapshot } from "@/lib/workflow";
import { ResearchMarkdown } from "./research-markdown";
import { ModelRequestPreview } from "./model-request-preview";
import { ModelRequestComparison } from "./model-request-comparison";
import { researchToolUrls } from "./research-tool-receipts";
import { CopyRunLink } from "./copy-run-link";
import { RunPassSourceComparison } from "./run-pass-source-comparison";

type Attempt = NonNullable<RunSnapshot["model_attempts"]>[number];
type SavedPass = {
  attempt: Attempt;
  number: number;
  kind: "Conclusion" | "Research lead" | "Workspace activity";
};
type PassSelection = ComparisonPasses & { path?: string; unavailable?: boolean };

function savedOutputs(run: RunSnapshot) {
  const outputs = new Map<string, SavedPass[]>();
  const counts = new Map<string, number>();
  for (const attempt of run.model_attempts ?? []) {
    const path = attemptPath(attempt);
    const number = (counts.get(path) ?? 0) + 1;
    counts.set(path, number);
    const result = attempt.result;
    if (attempt.status !== "completed" || !result) continue;
    const passes = outputs.get(path) ?? [];
    const kind = result.workspace_activity
      ? "Workspace activity"
      : result.next_lead
        ? "Research lead"
        : "Conclusion";
    passes.push({ attempt, number, kind });
    outputs.set(path, passes);
  }
  return outputs;
}

function selectedOutput(passes: SavedPass[], id: string | undefined) {
  return (
    passes.find((item) => item.attempt.id === id) ??
    passes.findLast((item) => item.kind === "Conclusion") ??
    passes.at(-1)
  );
}

function pathForPass(outputs: Map<string, SavedPass[]>, id: string | undefined) {
  return id
    ? [...outputs].find(([, passes]) => passes.some((pass) => pass.attempt.id === id))?.[0]
    : undefined;
}

function linkedPassSelection(
  runId: string,
  baselineId: string,
  current: Map<string, SavedPass[]>,
  earlier: Map<string, SavedPass[]>,
): PassSelection {
  if (typeof window === "undefined") return {};
  const params = new URL(window.location.href).searchParams;
  if (
    params.get("run")?.toLowerCase() !== runId ||
    params.get("compare")?.toLowerCase() !== baselineId
  ) {
    return {};
  }
  const requested = params.get("passes");
  if (!requested) return {};
  const [baselineAttempt, openAttempt, extra] = requested.toLowerCase().split(",");
  const baselinePath = pathForPass(earlier, baselineAttempt);
  const openPath = pathForPass(current, openAttempt);
  if (
    extra !== undefined ||
    (baselineAttempt && !baselinePath) ||
    (openAttempt && !openPath) ||
    (baselinePath && openPath && baselinePath !== openPath) ||
    (!baselinePath && !openPath)
  ) {
    return { unavailable: true };
  }
  return {
    path: baselinePath ?? openPath,
    baselineAttempt: baselineAttempt || undefined,
    openAttempt: openAttempt || undefined,
  };
}

function SavedOutput({
  run,
  title,
  path,
  passes,
  pass,
  onSelect,
}: {
  run: RunSnapshot;
  title: string;
  path: string;
  passes: SavedPass[];
  pass?: SavedPass;
  onSelect: (id: string) => void;
}) {
  const attempt = pass?.attempt;
  const result = attempt?.result;
  const sources = new Set<string>();
  if (attempt) {
    for (const item of run.model_attempts ?? []) {
      for (const source of item.result?.web_research?.sources ?? []) sources.add(source.url);
      for (const url of researchToolUrls(item.result)) sources.add(url);
      if (item.id === attempt.id) break;
    }
  }
  return (
    <section aria-label={title}>
      <h4>{title}</h4>
      {pass && attempt && result ? (
        <>
          {passes.length > 1 && (
            <label>
              Saved pass
              <select value={attempt.id} onChange={(event) => onSelect(event.target.value)}>
                {passes.map((item) => (
                  <option key={item.attempt.id} value={item.attempt.id}>
                    Pass {item.number} · {item.kind}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="field-hint">
            {graphLocation(run, path).node.label}
            {passes.length === 1 && ` · Pass ${pass.number} · ${pass.kind}`} · {attempt.model}
            {attempt.returned_model &&
              attempt.returned_model !== attempt.model &&
              ` · Returned ${attempt.returned_model}`}
          </p>
          <div className="research-conclusion">
            <ResearchMarkdown text={result.conclusion} sources={sources} />
          </div>
          {result.next_lead && (
            <>
              <h5>Next research lead</h5>
              <ResearchMarkdown text={result.next_lead} sources={sources} />
            </>
          )}
          {result.workspace_activity && result.workspace_activity.summary !== result.conclusion && (
            <p className="step-record">{result.workspace_activity.summary}</p>
          )}
          {attempt.input_artifact_id && (
            <ModelRequestPreview
              key={attempt.id}
              id={attempt.input_artifact_id}
              bytes={attempt.input_bytes}
            />
          )}
          <a
            className="button small"
            href={`?${new URLSearchParams({ view: "runs", run: run.id, attempt: attempt.id })}`}
            target="_blank"
            rel="noopener"
          >
            Open attempt in new tab
          </a>
        </>
      ) : (
        <p className="muted">No saved model output for this step.</p>
      )}
    </section>
  );
}

export function RunStepOutputComparison({
  run,
  baseline,
}: {
  run: RunSnapshot;
  baseline: RunSnapshot;
}) {
  const current = savedOutputs(run);
  const earlier = savedOutputs(baseline);
  const paths = new Set([...current.keys(), ...earlier.keys()]);
  const defaultPath =
    [...current.keys()].find(
      (path) =>
        current.get(path)?.some((item) => item.kind === "Conclusion") &&
        earlier.get(path)?.some((item) => item.kind === "Conclusion"),
    ) ??
    [...current.keys()].find((path) => earlier.has(path)) ??
    paths.values().next().value;
  const [selection, setSelection] = useState(() =>
    linkedPassSelection(run.id, baseline.id, current, earlier),
  );
  const [open, setOpen] = useState(Boolean(selection.path || selection.unavailable));
  const path = selection.path && paths.has(selection.path) ? selection.path : defaultPath;
  const unavailable = "This link points to a saved pass comparison that is unavailable.";
  if (!path) return selection.unavailable ? <p role="status">{unavailable}</p> : null;
  const baselinePasses = earlier.get(path) ?? [];
  const openPasses = current.get(path) ?? [];
  const baselinePass = selectedOutput(baselinePasses, selection.baselineAttempt);
  const openPass = selectedOutput(openPasses, selection.openAttempt);
  const options = open
    ? [...paths].map((value) => ({
        value,
        label: runStepLabel(current.has(value) ? run : baseline, value),
      }))
    : [];
  const labelCounts = new Map<string, number>();
  for (const { label } of options) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  return (
    <details
      className="comparison-step-outputs"
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (event.currentTarget.open) {
          setSelection((previous) => (previous.path ? previous : { ...previous, path }));
        }
      }}
    >
      <summary>Model outputs by step ({paths.size})</summary>
      {open && (
        <>
          {selection.unavailable && (
            <p className="field-hint" role="status">
              {unavailable}
            </p>
          )}
          <label>
            Comparison step
            <select value={path} onChange={(event) => setSelection({ path: event.target.value })}>
              {options.map(({ value, label }) => (
                <option value={value} key={value}>
                  {label}
                  {(labelCounts.get(label) ?? 0) > 1 && ` · ${value.replace(/^root\//, "")}`}
                </option>
              ))}
            </select>
          </label>
          <div className="actions">
            <CopyRunLink
              key={`${baselinePass?.attempt.id}/${openPass?.attempt.id}`}
              runId={run.id}
              target="passes"
              id={baseline.id}
              passes={{
                baselineAttempt: baselinePass?.attempt.id,
                openAttempt: openPass?.attempt.id,
              }}
            />
          </div>
          {baselinePass?.attempt.input_artifact_id && openPass?.attempt.input_artifact_id && (
            <ModelRequestComparison
              comparison={{
                id: baselinePass.attempt.input_artifact_id,
                bytes: baselinePass.attempt.input_bytes,
              }}
              current={{
                id: openPass.attempt.input_artifact_id,
                bytes: openPass.attempt.input_bytes,
              }}
            />
          )}
          {baselinePass && openPass && (
            <RunPassSourceComparison
              comparison={baselinePass.attempt.result?.web_research}
              current={openPass.attempt.result?.web_research}
            />
          )}
          <div className="comparison-output-versions">
            <SavedOutput
              key={`baseline/${path}`}
              run={baseline}
              title="Comparison run"
              path={path}
              pass={baselinePass}
              passes={baselinePasses}
              onSelect={(id) =>
                setSelection((previous) => ({
                  ...previous,
                  baselineAttempt: id,
                  unavailable: false,
                }))
              }
            />
            <SavedOutput
              key={`current/${path}`}
              run={run}
              title="Open run"
              path={path}
              pass={openPass}
              passes={openPasses}
              onSelect={(id) =>
                setSelection((previous) => ({ ...previous, openAttempt: id, unavailable: false }))
              }
            />
          </div>
        </>
      )}
    </details>
  );
}
