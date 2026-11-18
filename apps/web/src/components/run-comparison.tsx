import { useEffect, useState } from "react";
import { api, type RunSnapshot, type RunSummary } from "@/lib/workflow";
import { attemptPath, graphLocation } from "@/lib/run-inspection";
import { formatTime, RunStatus } from "./run-status";
import { ResearchMarkdown } from "./research-markdown";
import { researchToolUrls } from "./research-tool-receipts";

function reportedModels(run: RunSnapshot) {
  const models = new Set(run.model_attempts?.flatMap((attempt) => attempt.returned_model ?? []));
  return [...models].join(", ") || "Unreported";
}

function requestedModels(run: RunSnapshot) {
  const models = new Set(run.model_attempts?.map((attempt) => attempt.model));
  return [...models].join(", ") || "—";
}

function tokenUsage(run: RunSnapshot) {
  if (!run.usage || !run.model_attempts?.length) return "—";
  const usage = (run.usage.input_tokens + run.usage.output_tokens).toLocaleString();
  return run.usage.usage_complete ? usage : `${usage} (incomplete)`;
}

function RunComparisonColumn({ run }: { run: RunSnapshot }) {
  const saved = run.events.filter((event) => event.review_response?.feedback.trim());
  const attempt = run.model_attempts?.findLast(
    (item) =>
      item.status === "completed" &&
      item.result &&
      !item.result.next_lead &&
      !item.result.workspace_activity,
  );
  const sources = new Set<string>();
  for (const item of run.model_attempts ?? []) {
    for (const source of item.result?.web_research?.sources ?? []) sources.add(source.url);
    for (const url of researchToolUrls(item.result)) sources.add(url);
    if (item.id === attempt?.id) break;
  }
  return (
    <div className="comparison-record">
      <details>
        <summary>Research brief</summary>
        <p className="step-record">{run.brief}</p>
      </details>
      {saved.length > 0 && (
        <details>
          <summary>Reviewer feedback ({saved.length})</summary>
          {saved.map((event, index) => (
            <div key={event.path ?? index}>
              <strong>{event.label}</strong>
              <p className="step-record">{event.review_response?.feedback}</p>
            </div>
          ))}
        </details>
      )}
      {attempt?.result && (
        <details>
          <summary>
            Latest model output · {graphLocation(run, attemptPath(attempt)).node.label}
          </summary>
          <div className="research-conclusion">
            <ResearchMarkdown text={attempt.result.conclusion} sources={sources} />
          </div>
        </details>
      )}
    </div>
  );
}

function RunComparisonResult({ run, baseline }: { run: RunSnapshot; baseline: RunSnapshot }) {
  const model = (item: RunSnapshot) =>
    item.research_manifest?.settings.model ?? item.workflow.research?.model ?? "—";
  const rows = [
    { label: "Workflow revision", value: (item: RunSnapshot) => item.revision_number },
    { label: "Workflow default model", value: model },
    { label: "Models requested", value: requestedModels },
    { label: "Provider-reported models", value: reportedModels },
    { label: "Model attempts", value: (item: RunSnapshot) => item.model_attempts?.length ?? 0 },
    { label: "Reported tokens", value: tokenUsage },
    { label: "Pinned sources", value: (item: RunSnapshot) => item.evidence_ids?.length ?? 0 },
  ];
  const baselineEvidence = new Set(baseline.evidence_ids ?? []);
  const shared = run.evidence_ids?.filter((id) => baselineEvidence.has(id)).length ?? 0;
  return (
    <>
      <div
        className="model-activity-scroll"
        role="region"
        aria-label="Run comparison table"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th scope="col">Run</th>
              <th scope="col">Open run · {run.id.slice(0, 8)}</th>
              <th scope="col">Comparison run · {baseline.id.slice(0, 8)}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Status</th>
              <td>
                <RunStatus status={run.status} />
              </td>
              <td>
                <RunStatus status={baseline.status} />
              </td>
            </tr>
            {rows.map(({ label, value }) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{value(run)}</td>
                <td>{value(baseline)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row">Research record</th>
              <td>
                <RunComparisonColumn run={run} />
              </td>
              <td>
                <RunComparisonColumn run={baseline} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="field-hint">
        {shared} shared pinned {shared === 1 ? "source" : "sources"}
      </p>
    </>
  );
}

function Comparison({ run, id }: { run: RunSnapshot; id: string }) {
  const [result, setResult] = useState<RunSnapshot>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<RunSnapshot>(`runs/${id}`).then(
      (snapshot) => {
        if (active) setResult(snapshot);
      },
      (cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load the run.");
      },
    );
    return () => {
      active = false;
    };
  }, [id]);
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!result)
    return (
      <p className="field-hint" role="status">
        Loading comparison run…
      </p>
    );
  return <RunComparisonResult run={run} baseline={result} />;
}

export function RunComparison({ run, recentRuns }: { run: RunSnapshot; recentRuns: RunSummary[] }) {
  const [id, setId] = useState("");
  const options = recentRuns.filter(
    (item) => item.id !== run.id && (item.agent_id ?? null) === (run.agent_id ?? null),
  );
  const selected = options.some((item) => item.id === id) ? id : "";
  if (!options.length) return null;
  return (
    <details className="run-details run-comparison">
      <summary>Compare a recent run</summary>
      <label>
        Comparison run
        <select value={selected} onChange={(event) => setId(event.target.value)}>
          <option value="">Choose a run</option>
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {formatTime(item.created_at)} · {item.id.slice(0, 8)}
              {item.workflow_name !== run.workflow_name && ` · ${item.workflow_name}`}
            </option>
          ))}
        </select>
      </label>
      {selected && <Comparison key={selected} run={run} id={selected} />}
    </details>
  );
}
