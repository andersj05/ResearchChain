import { useEffect, useState } from "react";
import { api, type RecentRunSummary, type RunSnapshot, type RunSummary } from "@/lib/workflow";
import { formatTime, RunStatus } from "./run-status";
import { RunSetupChanges } from "./run-setup-changes";
import { RunOutputFileChanges } from "./run-output-file-changes";
import { RunStepOutputComparison } from "./run-step-output-comparison";
import { RunArchive } from "./run-archive";
import { CopyRunLink } from "./copy-run-link";

type ComparisonOption = RunSummary & { brief_excerpt?: string };

function comparisonOptionLabel(item: ComparisonOption, run: RunSnapshot) {
  const brief = item.brief_excerpt?.replace(/\s+/gu, " ").trim();
  const excerpt = brief && (brief.length > 72 ? `${brief.slice(0, 71).trimEnd()}…` : brief);
  return [
    excerpt,
    item.workflow_name !== run.workflow_name ? item.workflow_name : undefined,
    formatTime(item.created_at, true),
    item.id.slice(0, 8),
  ]
    .filter(Boolean)
    .join(" · ");
}

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
      <RunStepOutputComparison run={run} baseline={baseline} />
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
  recentRuns: RecentRunSummary[];
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
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

  const options: ComparisonOption[] = recentRuns.filter(
    (item) => item.id !== run.id && (item.agent_id ?? null) === agentId,
  );
  const compared = current?.run;
  for (const item of [compared && { ...compared, brief_excerpt: compared.brief }, archived]) {
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
    <section className="run-comparison" aria-label="Compare saved runs">
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
                {comparisonOptionLabel(item, run)}
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
    </section>
  );
}
