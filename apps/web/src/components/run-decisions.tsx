import { Button } from "@ui-sdk/react/button";
import { eventPath, graphLocation, pendingReviews, reviewPath } from "@/lib/run-inspection";
import type { RunSnapshot } from "@/lib/workflow";

export function RunDecisions({
  run,
  busy,
  inspect,
  iterate,
}: {
  run: RunSnapshot;
  busy: boolean;
  inspect: (path: string) => void;
  iterate: (brief: string) => Promise<void>;
}) {
  const pending = pendingReviews(run);
  const saved = run.events.filter((event) => event.kind === "review").reverse();
  if (!pending.length && !saved.length) {
    return <p className="muted">No review decisions yet.</p>;
  }
  return (
    <div className="run-decisions">
      {pending.length > 0 && (
        <section aria-label="Decisions needed">
          <h3>Decisions needed</h3>
          <ul>
            {pending.map((review) => {
              const path = reviewPath(review);
              const { node, parents } = graphLocation(run, path);
              return (
                <li key={review.interrupt_id}>
                  <h4>{node.label}</h4>
                  {parents.length > 0 && <small>{path.replaceAll("/", " › ")}</small>}
                  <p>{review.question}</p>
                  <button className="button small" type="button" onClick={() => inspect(path)}>
                    Open review
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {saved.length > 0 && (
        <section aria-label="Recorded decisions">
          <h3>Recorded decisions</h3>
          <ul>
            {saved.map((event) => {
              const path = eventPath(event);
              const { parents } = graphLocation(run, path);
              const feedback = event.review_response?.feedback.trim();
              const brief = `${run.brief.trimEnd()}\n\nReviewer feedback from ${event.label} (${run.id.slice(0, 8)}):\n${feedback ?? ""}`;
              return (
                <li key={path}>
                  <div className="decision-title">
                    <h4>{event.label}</h4>
                    <span>{event.detail}</span>
                  </div>
                  {parents.length > 0 && <small>{path.replaceAll("/", " › ")}</small>}
                  {feedback && <p>{feedback}</p>}
                  <div className="actions">
                    <button className="button small" type="button" onClick={() => inspect(path)}>
                      Inspect decision
                    </button>
                    {feedback && brief.length <= 10000 && (
                      <Button
                        className="button small"
                        disabled={busy}
                        onClick={() => iterate(brief)}
                      >
                        Iterate with this feedback
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
