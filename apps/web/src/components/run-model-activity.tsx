import { useState } from "react";
import { useOwner } from "@/components/access-context";
import { ownerStoragePrefix } from "@/lib/access";
import { attemptPath, graphLocation, modelAttemptStatus } from "@/lib/run-inspection";
import type { RunSnapshot } from "@/lib/workflow";

const orderLabels = {
  newest: "Newest first",
  oldest: "Oldest first",
  elapsed: "Longest elapsed time",
  tokens: "Most reported tokens",
};
type Order = keyof typeof orderLabels;

function savedOrder(key: string): Order {
  try {
    const value = localStorage.getItem(key);
    if (value && Object.hasOwn(orderLabels, value)) return value as Order;
  } catch {
    // The default remains available when browser storage is disabled.
  }
  return "newest";
}

export function RunModelActivity({
  run,
  inspect,
}: {
  run: RunSnapshot;
  inspect: (path: string, attemptId: string) => void;
}) {
  const { owner } = useOwner();
  const preference = `${ownerStoragePrefix(owner)}.model-activity-order`;
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState(() => savedOrder(preference));
  const changeOrder = (next: Order) => {
    setOrder(next);
    try {
      localStorage.setItem(preference, next);
    } catch {
      // The selected order still applies to the open view.
    }
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
    const elapsed = attempt.finished_at
      ? (Date.parse(attempt.finished_at) - Date.parse(attempt.created_at)) / 1000
      : null;
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
      elapsed: elapsed !== null && Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null,
      tokens,
    };
  });
  const search = query.trim().toLowerCase();
  const visible = rows.filter(({ attempt, label, location, status }) =>
    [label, location, status, attempt.model, attempt.returned_model].some((value) =>
      value?.toLowerCase().includes(search),
    ),
  );
  if (order !== "oldest") visible.reverse();
  if (order === "elapsed" || order === "tokens")
    visible.sort((left, right) => (right[order] ?? -1) - (left[order] ?? -1));

  if (!attempts.length) return <p className="muted">No model attempts have been recorded.</p>;

  return (
    <section className="run-model-activity" aria-label="Model attempts">
      <div className="model-activity-controls">
        <label>
          Filter model activity
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Step, model, or status"
          />
        </label>
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
      </div>
      {order === "tokens" && visible.some((item) => item.tokens === null) && (
        <p className="field-hint">Attempts with a missing token count follow complete totals.</p>
      )}
      {!visible.length ? (
        <p className="muted" role="status">
          No attempts match this filter.
        </p>
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
