import { useMemo } from "react";
import {
  eventPath,
  iterationPeers,
  runStepLabel,
  savedModelOutputs,
  selectedModelOutput,
  type IterationComparison,
  type SavedModelPass,
} from "@/lib/run-inspection";
import type { RunSnapshot } from "@/lib/workflow";
import { ArrowUpRight } from "lucide-react";

const outputKinds = {
  research: "Research",
  code: "Calculation",
  note: "Note",
} as const;
const outputPageSize = 40;

type OutputKind = keyof typeof outputKinds;
type Output = {
  path: string;
  kind: OutputKind;
  text: string;
  receipt?: string;
  attemptId?: string;
};

export type OutputFilter = { query: string; kind: OutputKind | ""; limit?: number };

function savedOutputs(run: RunSnapshot, modelOutputs: Map<string, SavedModelPass[]>) {
  const outputs = new Map<string, Output>();
  for (const event of run.events) {
    if (event.kind !== "note" && event.kind !== "code" && event.kind !== "research") continue;
    const path = eventPath(event);
    outputs.set(path, {
      path,
      kind: event.kind,
      text: event.code?.outputs.text ?? event.detail,
      receipt: event.code ? `Number output: ${event.code.outputs.number}` : undefined,
    });
  }
  for (const [path, passes] of modelOutputs) {
    const pass = selectedModelOutput(passes);
    const result = pass?.attempt.result;
    if (!pass || !result) continue;
    const text = [result.workspace_activity?.summary || result.conclusion, result.next_lead]
      .filter(Boolean)
      .join("\n");
    outputs.set(path, {
      path,
      kind: "research",
      text,
      receipt: `Pass ${pass.number} · ${pass.kind}`,
      attemptId: pass.attempt.id,
    });
  }
  return [...outputs.values()].reverse();
}

function excerpt(text: string, search: string) {
  const line = text.replace(/\s+/g, " ").trim();
  const match = line.toLowerCase().indexOf(search);
  const start = match > 160 ? match - 45 : 0;
  const end = start + 250;
  return `${start > 0 ? "…" : ""}${line.slice(start, end).trimEnd()}${end < line.length ? "…" : ""}`;
}

export function RunOutputs({
  run,
  filter,
  onFilterChange,
  inspect,
  onCompare,
}: {
  run: RunSnapshot;
  filter: OutputFilter;
  onFilterChange: (filter: OutputFilter) => void;
  inspect: (path: string, attemptId?: string) => void;
  onCompare: (selection: IterationComparison, path: string) => void;
}) {
  const { outputs, labelCounts, modelOutputs } = useMemo(() => {
    const labelCounts = new Map<string, number>();
    const modelOutputs = savedModelOutputs(run);
    const outputs = savedOutputs(run, modelOutputs).map((output) => {
      const label = runStepLabel(run, output.path);
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
      return { ...output, label };
    });
    return { outputs, labelCounts, modelOutputs };
  }, [run]);
  if (!outputs.length) return <p className="muted">No step outputs have been saved.</p>;

  const search = filter.query.trim().toLowerCase();
  const visible = outputs.filter(
    ({ path, kind, text, label, receipt }) =>
      (!filter.kind || kind === filter.kind) &&
      (!search ||
        [path, text, label, receipt].some((value) => value?.toLowerCase().includes(search))),
  );
  const page = visible.slice(0, filter.limit ?? outputPageSize);
  const hasMore = visible.length > page.length;

  return (
    <section className="run-outputs" aria-label="Saved step outputs">
      <div className="run-output-filters">
        <label>
          Find an output
          <input
            type="search"
            value={filter.query}
            onChange={(event) => onFilterChange({ kind: filter.kind, query: event.target.value })}
            placeholder="Step, iteration, or output text"
          />
        </label>
        <label>
          Output type
          <select
            value={filter.kind}
            onChange={(event) =>
              onFilterChange({
                query: filter.query,
                kind: event.target.value as OutputFilter["kind"],
              })
            }
          >
            <option value="">All outputs</option>
            {Object.entries(outputKinds).map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="field-hint" role="status">
        {hasMore ? `Showing ${page.length} of ${visible.length} outputs` : null}
        {!hasMore &&
          visible.length > 0 &&
          `${visible.length} ${visible.length === 1 ? "output" : "outputs"}`}
        {!visible.length && "No outputs match these filters."}
      </p>
      {page.length > 0 && (
        <ol className="run-output-list">
          {page.map(({ path, kind, text, receipt, attemptId, label }) => {
            const peers = attemptId ? iterationPeers(modelOutputs.keys(), path) : [];
            const peer = peers.findLast(({ difference }) => difference < 0) ?? peers[0];
            const peerPass = peer && selectedModelOutput(modelOutputs.get(peer.path) ?? []);
            const compare = () => {
              if (!attemptId || !peerPass || !peer) return;
              const original = { path, attemptId };
              const other = { path: peer.path, attemptId: peerPass.attempt.id };
              onCompare(
                peer.difference < 0
                  ? { comparison: other, current: original }
                  : { comparison: original, current: other },
                path,
              );
            };
            const rowLabel =
              (labelCounts.get(label) ?? 0) > 1
                ? `${label} · ${path.replace(/^root\//, "")}`
                : label;
            return (
              <li key={path}>
                <div className="run-output-actions">
                  <button
                    className="text-link"
                    type="button"
                    onClick={() => inspect(path, attemptId)}
                  >
                    <span>{rowLabel}</span>
                    <ArrowUpRight size={14} aria-hidden />
                  </button>
                  {peerPass && (
                    <button
                      className="button small"
                      type="button"
                      onClick={compare}
                      aria-label={`Compare iterations for ${rowLabel}`}
                      data-output-comparison-path={path}
                    >
                      Compare iterations
                    </button>
                  )}
                </div>
                <small>
                  {outputKinds[kind]}
                  {receipt && ` · ${receipt}`}
                </small>
                {text && <p>{excerpt(text, search)}</p>}
              </li>
            );
          })}
        </ol>
      )}
      {hasMore && (
        <button
          className="button small"
          type="button"
          onClick={() => onFilterChange({ ...filter, limit: page.length + outputPageSize })}
        >
          Show more outputs
        </button>
      )}
    </section>
  );
}
