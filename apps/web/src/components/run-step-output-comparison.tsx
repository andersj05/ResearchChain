import { useState } from "react";
import { attemptPath, graphLocation } from "@/lib/run-inspection";
import type { RunSnapshot } from "@/lib/workflow";
import { ResearchMarkdown } from "./research-markdown";
import { ModelRequestPreview } from "./model-request-preview";
import { researchToolUrls } from "./research-tool-receipts";

type Attempt = NonNullable<RunSnapshot["model_attempts"]>[number];
type SavedPass = {
  attempt: Attempt;
  number: number;
  kind: "Conclusion" | "Research lead" | "Workspace activity";
};

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

function stepLabel(run: RunSnapshot, path: string) {
  const { node, parents } = graphLocation(run, path);
  const context = parents.map((parent) => {
    const iteration = /^iteration-(\d+)\//.exec(path.slice(parent.path.length + 1))?.[1];
    return iteration ? `Iteration ${iteration} · ${parent.label}` : parent.label;
  });
  return [node.label, ...context].join(" · ");
}

function SavedOutput({
  run,
  title,
  path,
  passes,
}: {
  run: RunSnapshot;
  title: string;
  path: string;
  passes: SavedPass[];
}) {
  const [selected, setSelected] = useState<string>();
  const pass =
    passes.find((item) => item.attempt.id === selected) ??
    passes.findLast((item) => item.kind === "Conclusion") ??
    passes.at(-1);
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
              <select value={attempt.id} onChange={(event) => setSelected(event.target.value)}>
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
  const [selected, setSelected] = useState<string>();
  const [open, setOpen] = useState(false);
  const path = selected && paths.has(selected) ? selected : defaultPath;
  if (!path) return null;
  const options = open
    ? [...paths].map((value) => ({
        value,
        label: stepLabel(current.has(value) ? run : baseline, value),
      }))
    : [];
  const labelCounts = new Map<string, number>();
  for (const { label } of options) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  return (
    <details
      className="comparison-step-outputs"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (event.currentTarget.open) setSelected(path);
      }}
    >
      <summary>Model outputs by step ({paths.size})</summary>
      {open && (
        <>
          <label>
            Comparison step
            <select value={path} onChange={(event) => setSelected(event.target.value)}>
              {options.map(({ value, label }) => (
                <option value={value} key={value}>
                  {label}
                  {(labelCounts.get(label) ?? 0) > 1 && ` · ${value.replace(/^root\//, "")}`}
                </option>
              ))}
            </select>
          </label>
          <div className="comparison-output-versions">
            <SavedOutput
              key={`baseline/${path}`}
              run={baseline}
              title="Comparison run"
              path={path}
              passes={earlier.get(path) ?? []}
            />
            <SavedOutput
              key={`current/${path}`}
              run={run}
              title="Open run"
              path={path}
              passes={current.get(path) ?? []}
            />
          </div>
        </>
      )}
    </details>
  );
}
