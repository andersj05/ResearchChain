export type TimedAttempt = {
  attempt: { id: string; model: string };
  path: string;
  label: string;
  pass: number;
  status: string;
  started: number;
  elapsed: number | null;
};

export function ModelActivityTimeline({
  rows,
  visible,
  fitVisible,
  inspect,
}: {
  rows: TimedAttempt[];
  visible: TimedAttempt[];
  fitVisible: boolean;
  inspect: (path: string, attemptId: string) => void;
}) {
  const measured = (fitVisible ? visible : rows).filter(({ started }) => Number.isFinite(started));
  if (!measured.length) return <p className="muted">No model attempt start times were recorded.</p>;

  const start = Math.min(...measured.map((row) => row.started));
  const span = Math.max(...measured.map((row) => row.started - start + (row.elapsed ?? 0)));
  const range = span || 1;
  const elapsedLabel = (seconds: number) => `${Number(seconds.toFixed(2))} s`;
  const visibleRows = visible.toSorted((left, right) => {
    const leftTime = Number.isFinite(left.started) ? left.started : Infinity;
    const rightTime = Number.isFinite(right.started) ? right.started : Infinity;
    return leftTime === rightTime ? 0 : leftTime - rightTime;
  });
  return (
    <section className="model-timeline" aria-label="Model activity timeline">
      <p className="field-hint">
        {fitVisible
          ? "Time since the first matching model attempt"
          : "Time since the first recorded model attempt"}
      </p>
      <div className="model-timeline-row model-timeline-axis" aria-hidden="true">
        <span>Step and pass</span>
        <div>
          <span>0 s</span>
          {span > 0 && <span>{elapsedLabel(span / 2)}</span>}
          {span > 0 && <span>{elapsedLabel(span)}</span>}
        </div>
      </div>
      <ol>
        {visibleRows.map(({ attempt, path, label, pass, status, started, elapsed }) => {
          const recorded = Number.isFinite(started);
          const offset = recorded ? started - start : 0;
          return (
            <li className="model-timeline-row" key={attempt.id}>
              <div>
                <button
                  className="text-link"
                  type="button"
                  data-model-activity-attempt={attempt.id}
                  onClick={() => inspect(path, attempt.id)}
                >
                  {label} · <span>Pass {pass}</span>
                </button>
                <span className="model-timeline-meta">
                  {status} · {attempt.model}
                </span>
              </div>
              <div>
                <div className="model-timeline-track" aria-hidden="true">
                  {recorded && (
                    <span
                      className="model-timeline-mark"
                      data-unknown-duration={elapsed === null || undefined}
                      style={{
                        left: `${(offset / range) * 100}%`,
                        width: `${((elapsed ?? 0) / range) * 100}%`,
                      }}
                    />
                  )}
                </div>
                <span className="model-timeline-meta">
                  {recorded && `Start +${elapsedLabel(offset)} · `}
                  {elapsed === null ? "Duration unavailable" : `${elapsedLabel(elapsed)} elapsed`}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
