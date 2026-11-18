import { useState } from "react";
import { useOwner } from "@/components/access-context";
import { ownerStoragePrefix } from "@/lib/access";
import { attemptPath, graphLocation, modelAttemptStatus, runStepLabel } from "@/lib/run-inspection";
import type { RunSnapshot } from "@/lib/workflow";
import { ModelActivityTimeline } from "./model-activity-timeline";

const orderLabels = {
  newest: "Newest first",
  oldest: "Oldest first",
  elapsed: "Longest elapsed time",
  tokens: "Most reported tokens",
};
type Order = keyof typeof orderLabels;
export type ModelActivityFilter = { query: string; step?: string; fitFiltered: boolean };

function readPreference(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The selected option still applies to the open view.
  }
}

export function RunModelActivity({
  run,
  inspect,
  filter,
  onFilterChange,
}: {
  run: RunSnapshot;
  inspect: (path: string, attemptId: string) => void;
  filter: ModelActivityFilter;
  onFilterChange: (filter: ModelActivityFilter) => void;
}) {
  const { owner } = useOwner();
  const orderKey = `${ownerStoragePrefix(owner)}.model-activity-order`;
  const displayKey = `${ownerStoragePrefix(owner)}.model-activity-display`;
  const { query, step, fitFiltered } = filter;
  const [display, setDisplay] = useState<"table" | "timeline">(() =>
    readPreference(displayKey) === "timeline" ? "timeline" : "table",
  );
  const [order, setOrder] = useState<Order>(() => {
    const value = readPreference(orderKey);
    return value && Object.hasOwn(orderLabels, value) ? (value as Order) : "newest";
  });
  const changeOrder = (next: Order) => {
    setOrder(next);
    storePreference(orderKey, next);
  };
  const changeDisplay = (next: typeof display) => {
    setDisplay(next);
    storePreference(displayKey, next);
  };
  const attempts = run.model_attempts ?? [];
  const passes = new Map<string, number>();
  const rows = attempts.map((attempt) => {
    const path = attemptPath(attempt);
    const pass = (passes.get(path) ?? 0) + 1;
    passes.set(path, pass);
    const { node, parents } = graphLocation(run, path);
    const label = node.label;
    const location = parents.length ? path.replaceAll("/", " › ") : "";
    const status = modelAttemptStatus(attempt);
    const started = Date.parse(attempt.created_at) / 1000;
    const elapsed = attempt.finished_at ? Date.parse(attempt.finished_at) / 1000 - started : null;
    const tokens =
      attempt.input_tokens != null && attempt.output_tokens != null
        ? attempt.input_tokens + attempt.output_tokens
        : null;
    return {
      attempt,
      path,
      pass,
      label,
      location,
      status,
      started,
      elapsed: elapsed !== null && Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null,
      tokens,
    };
  });
  const search = query.trim().toLowerCase();
  const filtered = Boolean(search || step);
  const steps = [...passes.keys()].map((path) => ({ path, label: runStepLabel(run, path) }));
  const labelCounts = new Map<string, number>();
  for (const { label } of steps) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  const visible = rows.filter(
    ({ attempt, path, label, location, status }) =>
      (!step || path === step) &&
      (!search ||
        [label, location, status, attempt.model, attempt.returned_model].some((value) =>
          value?.toLowerCase().includes(search),
        )),
  );
  if (display === "table" && order !== "oldest") visible.reverse();
  if (display === "table" && (order === "elapsed" || order === "tokens"))
    visible.sort((left, right) => (right[order] ?? -1) - (left[order] ?? -1));

  if (!attempts.length) return <p className="muted">No model attempts have been recorded.</p>;

  return (
    <section className="run-model-activity" aria-label="Model attempts">
      <div className="model-activity-controls">
        <label>
          Workflow step
          <select
            value={step ?? ""}
            onChange={(event) => onFilterChange({ ...filter, step: event.target.value || undefined })}
          >
            <option value="">All steps</option>
            {steps.map(({ path, label }) => (
              <option key={path} value={path}>
                {label}
                {(labelCounts.get(label) ?? 0) > 1 && ` · ${path.replace(/^root\//, "")}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Filter model activity
          <input
            type="search"
            value={query}
            onChange={(event) => onFilterChange({ ...filter, query: event.target.value })}
            placeholder="Step, model, or status"
          />
        </label>
        <label>
          Display model activity
          <select
            value={display}
            onChange={(event) =>
              changeDisplay(event.target.value === "timeline" ? "timeline" : "table")
            }
          >
            <option value="table">Table</option>
            <option value="timeline">Timeline</option>
          </select>
        </label>
        {display === "table" && (
          <label>
            Sort model activity
            <select value={order} onChange={(event) => changeOrder(event.target.value as Order)}>
              {Object.entries(orderLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        {display === "timeline" && filtered && (
          <label>
            Timeline range
            <select
              value={fitFiltered ? "filtered" : "full"}
              onChange={(event) =>
                onFilterChange({ ...filter, fitFiltered: event.target.value === "filtered" })
              }
            >
              <option value="full">Entire run</option>
              <option value="filtered">Filtered attempts</option>
            </select>
          </label>
        )}
      </div>
      {display === "table" &&
        order === "tokens" &&
        visible.some((item) => item.tokens === null) && (
          <p className="field-hint">Attempts with a missing token count follow complete totals.</p>
        )}
      {!visible.length ? (
        <p className="muted" role="status">
          No attempts match this filter.
        </p>
      ) : display === "timeline" ? (
        <ModelActivityTimeline
          rows={rows}
          visible={visible}
          fitVisible={filtered && fitFiltered}
          inspect={inspect}
        />
      ) : (
        <div
          className="model-activity-scroll"
          role="region"
          aria-label="Model activity table"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Step and pass</th>
                <th scope="col">Status</th>
                <th scope="col">Requested model</th>
                <th scope="col">Reported model</th>
                <th scope="col">Input / output tokens</th>
                <th scope="col">Elapsed</th>
                <th scope="col">Started</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ attempt, path, pass, label, location, status, elapsed }) => (
                <tr key={attempt.id}>
                  <th scope="row">
                    <button type="button" onClick={() => inspect(path, attempt.id)}>
                      {label} · Pass {pass}
                    </button>
                    {location && <small>{location}</small>}
                  </th>
                  <td>
                    <span className="step-status" data-status={status}>
                      {status}
                    </span>
                    {attempt.reason && <small>{attempt.reason}</small>}
                  </td>
                  <td>{attempt.model}</td>
                  <td>{attempt.returned_model ?? "Not reported"}</td>
                  <td>
                    {attempt.input_tokens?.toLocaleString() ?? "Unreported"} /{" "}
                    {attempt.output_tokens?.toLocaleString() ?? "Unreported"}
                  </td>
                  <td>{elapsed !== null ? `${elapsed.toFixed(1)} s` : "—"}</td>
                  <td>
                    <time dateTime={attempt.created_at}>
                      {new Date(attempt.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
