import { Button } from "@ui-sdk/react/button";
import { contentUrl } from "@/lib/evidence";
import {
  attemptPath,
  directLoopIteration,
  eventPath,
  feedbackRecipients,
  graphLocation,
  nextLoopIteration,
  pendingReviews,
  reviewPath,
} from "@/lib/run-inspection";
import type { RunSnapshot, WorkflowNode } from "@/lib/workflow";

type DecisionEvent = RunSnapshot["events"][number];

export type FeedbackBriefDraft = {
  brief: string;
  selected: string[];
};

const briefLimit = 10_000;

function feedbackEntry(event: DecisionEvent, runId: string) {
  const path = eventPath(event).split("/");
  const run = runId.slice(0, 8);
  const origin = path.length > 2 ? `${path.slice(1).join(" › ")}, run ${run}` : run;
  return `Reviewer feedback from ${event.label} (${origin}):\n${event.review_response?.feedback ?? ""}`;
}

function FeedbackBrief({
  decisions,
  run,
  draft,
  onDraftChange,
  busy,
  iterate,
}: {
  decisions: DecisionEvent[];
  run: RunSnapshot;
  draft: FeedbackBriefDraft | null;
  onDraftChange: (draft: FeedbackBriefDraft) => void;
  busy: boolean;
  iterate: (brief: string) => Promise<void>;
}) {
  const { brief, selected } = draft ?? { brief: run.brief, selected: [] };
  const entries = decisions.filter((event) => selected.includes(eventPath(event)));
  const combined = [brief.trimEnd(), ...entries.map((event) => feedbackEntry(event, run.id))]
    .filter(Boolean)
    .join("\n\n");
  const overLimit = combined.length > briefLimit;

  return (
    <details className="decision-brief" open={draft !== null}>
      <summary>Combine feedback for next run</summary>
      <fieldset>
        <legend>Feedback to include</legend>
        {decisions.map((event) => {
          const path = eventPath(event);
          const nested = path.split("/").length > 2;
          return (
            <label className="decision-brief-choice" key={path}>
              <input
                type="checkbox"
                checked={selected.includes(path)}
                onChange={(change) =>
                  onDraftChange({
                    brief,
                    selected: change.target.checked
                      ? [...selected, path]
                      : selected.filter((item) => item !== path),
                  })
                }
              />
              <span>
                <strong>{event.label}</strong>
                {nested && <small>{path.replaceAll("/", " › ")}</small>}
                <span className="decision-brief-feedback">{event.review_response?.feedback}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <label className="decision-brief-field">
        Prior research brief
        <textarea
          rows={4}
          value={brief}
          onChange={(change) => onDraftChange({ brief: change.target.value, selected })}
        />
      </label>
      {entries.length > 0 && (
        <label className="decision-brief-field">
          Next research brief
          <textarea rows={8} readOnly value={combined} />
        </label>
      )}
      {overLimit && (
        <p className="error" role="alert">
          This brief has {combined.length.toLocaleString()} characters. Shorten the prior brief or
          clear a selection to fit the {briefLimit.toLocaleString()} character limit.
        </p>
      )}
      <Button
        className="button small"
        disabled={busy || entries.length === 0 || overLimit}
        onClick={() => iterate(combined)}
      >
        Open next experiment in Build
      </Button>
    </details>
  );
}

function FeedbackInputs({
  recipients,
  attempts,
  inspect,
}: {
  recipients: { node: WorkflowNode; path?: string; iteration?: number }[];
  attempts: RunSnapshot["model_attempts"];
  inspect: (path: string, attemptId?: string) => void;
}) {
  return (
    <details className="decision-feedback-inputs">
      <summary>Steps wired to this feedback ({recipients.length})</summary>
      <ul>
        {recipients.map(({ node, path, iteration }) => {
          const attempt = path
            ? attempts?.findLast((item) => item.input_artifact_id && attemptPath(item) === path)
            : undefined;
          const label = iteration ? `${node.label} · Iteration ${iteration}` : node.label;
          return (
            <li key={`${node.id}/${iteration ?? "current"}`}>
              {path ? (
                <button
                  className="text-link"
                  type="button"
                  onClick={() => inspect(path, attempt?.id)}
                >
                  {label}
                </button>
              ) : (
                <span>{label} (no recorded use)</span>
              )}
              {attempt && attempt.input_artifact_id ? (
                <a
                  className="text-link"
                  href={contentUrl(attempt.input_artifact_id)}
                  aria-label={`Saved request for ${label}`}
                >
                  Saved request
                </a>
              ) : (
                path && node.kind === "research" && <small>No saved request</small>
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
  feedbackDraft,
  onFeedbackDraftChange,
}: {
  run: RunSnapshot;
  busy: boolean;
  inspect: (path: string, attemptId?: string) => void;
  iterate: (brief: string) => Promise<void>;
  feedbackDraft: FeedbackBriefDraft | null;
  onFeedbackDraftChange: (draft: FeedbackBriefDraft) => void;
}) {
  const pending = pendingReviews(run);
  const saved = run.events.filter((event) => event.kind === "review");
  const withFeedback = saved.filter((event) => event.review_response?.feedback.trim());
  if (!pending.length && !saved.length) {
    return <p className="muted">No review decisions yet.</p>;
  }
  const observed = new Set([
    ...run.events.map(eventPath),
    ...(run.model_attempts ?? []).map(attemptPath),
  ]);
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
          {withFeedback.length > 1 && (
            <FeedbackBrief
              decisions={withFeedback}
              run={run}
              draft={feedbackDraft}
              onDraftChange={onFeedbackDraftChange}
              busy={busy}
              iterate={iterate}
            />
          )}
          <ul>
            {saved.toReversed().map((event) => {
              const path = eventPath(event);
              const { graph, node, parents, prefix } = graphLocation(run, path);
              const feedback = event.review_response?.feedback.trim();
              const current = feedback ? feedbackRecipients(graph, node.id) : [];
              const later = feedback
                ? feedbackRecipients(graph, node.id, "previous_iteration")
                : [];
              const next = later.length
                ? nextLoopIteration(directLoopIteration(run, path))
                : undefined;
              const recipients = [
                ...current.map((node) => ({ node, path: `${prefix}/${node.id}` })),
                ...(next
                  ? later.map((node) => {
                      const path = `${next.prefix}/${node.id}`;
                      return {
                        node,
                        path: observed.has(path) ? path : undefined,
                        iteration: next.number,
                      };
                    })
                  : []),
              ];
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
                      attempts={run.model_attempts}
                      inspect={inspect}
                    />
                  )}
                  <div className="actions">
                    <button className="button small" type="button" onClick={() => inspect(path)}>
                      Inspect decision
                    </button>
                    {feedback && brief.length <= briefLimit && (
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
