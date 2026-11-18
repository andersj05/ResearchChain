import { Button } from "@ui-sdk/react/button";
import { contentUrl } from "@/lib/evidence";
import {
  attemptPath,
  eventPath,
  feedbackRecipients,
  graphLocation,
  pendingReviews,
  reviewPath,
} from "@/lib/run-inspection";
import type { RunSnapshot, WorkflowNode } from "@/lib/workflow";

function FeedbackInputs({
  recipients,
  prefix,
  attempts,
  inspect,
}: {
  recipients: WorkflowNode[];
  prefix: string;
  attempts: RunSnapshot["model_attempts"];
  inspect: (path: string, attemptId?: string) => void;
}) {
  return (
    <details className="decision-feedback-inputs">
      <summary>Steps wired to this feedback ({recipients.length})</summary>
      <ul>
        {recipients.map((node) => {
          const path = `${prefix}/${node.id}`;
          const attempt = attempts?.findLast(
            (item) => item.input_artifact_id && attemptPath(item) === path,
          );
          return (
            <li key={node.id}>
              <button
                className="text-link"
                type="button"
                onClick={() => inspect(path, attempt?.id)}
              >
                {node.label}
              </button>
              {attempt?.input_artifact_id ? (
                <a
                  className="text-link"
                  href={contentUrl(attempt.input_artifact_id)}
                  aria-label={`Saved request for ${node.label}`}
                >
                  Saved request
                </a>
              ) : (
                node.kind === "research" && <small>No saved request</small>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export function RunDecisions({
  run,
  busy,
  inspect,
  iterate,
}: {
  run: RunSnapshot;
  busy: boolean;
  inspect: (path: string, attemptId?: string) => void;
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
              const { graph, node, parents, prefix } = graphLocation(run, path);
              const feedback = event.review_response?.feedback.trim();
              const recipients = feedback ? feedbackRecipients(graph, node.id) : [];
              const brief = `${run.brief.trimEnd()}\n\nReviewer feedback from ${event.label} (${run.id.slice(0, 8)}):\n${feedback ?? ""}`;
              return (
                <li key={path}>
                  <div className="decision-title">
                    <h4>{event.label}</h4>
                    <span>{event.detail}</span>
                  </div>
                  {parents.length > 0 && <small>{path.replaceAll("/", " › ")}</small>}
                  {feedback && <p>{feedback}</p>}
                  {recipients.length > 0 && (
                    <FeedbackInputs
                      recipients={recipients}
                      prefix={prefix}
                      attempts={run.model_attempts}
                      inspect={inspect}
                    />
                  )}
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
