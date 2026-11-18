import { useState } from "react";
import { attemptPath, graphLocation } from "@/lib/run-inspection";
import type { RunSnapshot } from "@/lib/workflow";
import { ResearchMarkdown } from "./research-markdown";
import { researchToolUrls } from "./research-tool-receipts";

type Attempt = NonNullable<RunSnapshot["model_attempts"]>[number];

function latestOutputs(run: RunSnapshot) {
  const outputs = new Map<string, Attempt>();
  for (const attempt of (run.model_attempts ?? []).toReversed()) {
    const result = attempt.result;
    if (
      attempt.status !== "completed" ||
      !result ||
      result.next_lead ||
      result.workspace_activity
    ) {
      continue;
    }
    const path = attemptPath(attempt);
    if (!outputs.has(path)) outputs.set(path, attempt);
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
  attempt,
}: {
  run: RunSnapshot;
  title: string;
  path: string;
  attempt?: Attempt;
}) {
  const sources = new Set<string>();
  let pass = 0;
  if (attempt) {
    for (const item of run.model_attempts ?? []) {
      for (const source of item.result?.web_research?.sources ?? []) sources.add(source.url);
      for (const url of researchToolUrls(item.result)) sources.add(url);
      if (attemptPath(item) === path) pass += 1;
      if (item.id === attempt.id) break;
    }
  }
  return (
    <section aria-label={title}>
      <h4>{title}</h4>
      {attempt?.result ? (
        <>
          <p className="field-hint">
            {graphLocation(run, path).node.label} · Pass {pass} · {attempt.model}
            {attempt.returned_model &&
              attempt.returned_model !== attempt.model &&
              ` · Returned ${attempt.returned_model}`}
          </p>
          <div className="research-conclusion">
            <ResearchMarkdown text={attempt.result.conclusion} sources={sources} />
          </div>
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
  const current = latestOutputs(run);
  const earlier = latestOutputs(baseline);
  const paths = new Set([...current.keys(), ...earlier.keys()]);
  const defaultPath =
    [...current.keys()].find((path) => earlier.has(path)) ?? paths.values().next().value;
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
              run={baseline}
              title="Comparison run"
              path={path}
              attempt={earlier.get(path)}
            />
            <SavedOutput run={run} title="Open run" path={path} attempt={current.get(path)} />
          </div>
        </>
      )}
    </details>
  );
}
