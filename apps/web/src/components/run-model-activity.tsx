import { useState } from "react";
import { attemptPath, graphLocation, modelAttemptStatus } from "@/lib/run-inspection";
import type { RunSnapshot } from "@/lib/workflow";

export function RunModelActivity({
  run,
  inspect,
}: {
  run: RunSnapshot;
  inspect: (path: string, attemptId: string) => void;
}) {
  const [query, setQuery] = useState("");
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
    return { attempt, path, pass, label, location, status };
  });
  const search = query.trim().toLowerCase();
  const visible = rows
    .reverse()
    .filter(({ attempt, label, location, status }) =>
      [label, location, status, attempt.model, attempt.returned_model].some((value) =>
        value?.toLowerCase().includes(search),
      ),
    );

  if (!attempts.length) return <p className="muted">No model attempts have been recorded.</p>;

  return (
    <section className="run-model-activity" aria-label="Model attempts">
      <label>
        Filter model activity
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Step, model, or status"
        />
      </label>
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
                <th scope="col">Started</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ attempt, path, pass, label, location, status }) => (
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
                    {attempt.input_tokens?.toLocaleString() ?? "—"} /{" "}
                    {attempt.output_tokens?.toLocaleString() ?? "—"}
                  </td>
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
