import { useEffect, useState } from "react";
import { api, type RunSnapshot, type RunSummary } from "@/lib/workflow";
import { attemptPath, graphLocation } from "@/lib/run-inspection";
import { formatTime, RunStatus } from "./run-status";
import { ResearchMarkdown } from "./research-markdown";
import { researchToolUrls } from "./research-tool-receipts";
import { RunSetupChanges } from "./run-setup-changes";
import { RunOutputFileChanges } from "./run-output-file-changes";
import { RunArchive } from "./run-archive";
import { CopyRunLink } from "./copy-run-link";

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
      <div className="actions">
        <CopyRunLink runId={run.id} target="compare" id={baseline.id} />
      </div>
      <RunSetupChanges before={baseline} after={run} />
      <RunOutputFileChanges before={baseline} after={run} />
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

export function RunComparison({
  run,
  recentRuns,
  selected,
  onSelect,
}: {
  run: RunSnapshot;
  recentRuns: RunSummary[];
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const [open, setOpen] = useState(Boolean(selected));
  const [archived, setArchived] = useState<RunSummary>();
  const [response, setResponse] = useState<{ id: string; run?: RunSnapshot; error?: string }>();
  const current = response?.id === selected ? response : undefined;
  const agentId = run.agent_id ?? null;
  useEffect(() => {
    if (!selected) return;
    let active = true;
    api<RunSnapshot>(`runs/${encodeURIComponent(selected)}`).then(
      (snapshot) => {
        if (!active) return;
        setResponse(
          (snapshot.agent_id ?? null) === agentId
            ? { id: selected, run: snapshot }
            : { id: selected, error: "Select a comparison run from the same agent." },
        );
      },
      (cause: unknown) => {
        if (active)
          setResponse({
            id: selected,
            error: cause instanceof Error ? cause.message : "Unable to load the run.",
          });
      },
    );
    return () => {
      active = false;
    };
  }, [selected, agentId]);

  const options = recentRuns.filter(
    (item) => item.id !== run.id && (item.agent_id ?? null) === agentId,
  );
  for (const item of [archived, current?.run]) {
    if (
      item &&
      item.id !== run.id &&
      (item.agent_id ?? null) === agentId &&
      !options.some((option) => option.id === item.id)
    ) {
      options.push(item);
    }
  }
  const unresolved = selected && !options.some((item) => item.id === selected);
  return (
    <details
      className="run-details run-comparison"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Compare a saved run</summary>
      {(options.length > 0 || selected) && (
        <label>
          Comparison run
          <select
            value={selected ?? ""}
            onChange={(event) => onSelect(event.target.value || undefined)}
          >
            <option value="">Choose a run</option>
            {unresolved && <option value={selected}>Run {selected.slice(0, 8)}</option>}
            {options.map((item) => (
              <option key={item.id} value={item.id}>
                {formatTime(item.created_at, true)} · {item.id.slice(0, 8)}
                {item.workflow_name !== run.workflow_name && ` · ${item.workflow_name}`}
              </option>
            ))}
          </select>
        </label>
      )}
      <RunArchive
        key={run.id}
        agentId={run.agent_id}
        excludeRun={run.id}
        onSelect={(item) => {
          setArchived(item);
          onSelect(item.id);
        }}
      />
      {selected && !current && (
        <p className="field-hint" role="status">
          Loading comparison run…
        </p>
      )}
      {current?.error && (
        <p className="error" role="alert">
          {current.error}
        </p>
      )}
      {current?.run && (
        <RunComparisonResult key={current.run.id} run={run} baseline={current.run} />
      )}
    </details>
  );
}
