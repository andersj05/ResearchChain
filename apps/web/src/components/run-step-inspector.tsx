import { Button } from "@ui-sdk/react/button";
import { ArrowUpRight, Check, X } from "lucide-react";
import type { RunSnapshot } from "@/lib/workflow";
import {
  attemptPath,
  childGraphs,
  eventPath,
  graphLocation,
  pendingReviews,
  reviewPath,
  type StepStatus,
} from "@/lib/run-inspection";
import { StepResearchResults } from "./research-results";
import { nodePresentation } from "./node-kind";

type Event = RunSnapshot["events"][number];
export type ResumeReview = (
  decision: "approve" | "reject",
  interruptId: string,
  feedback: string,
) => Promise<void>;

function StepEvent({ event }: { event: Event }) {
  if (!event.code)
    return (
      <>
        <p className="step-record">{event.detail}</p>
        {event.review_response?.feedback && (
          <div className="saved-feedback">
            <h4>Reviewer feedback</h4>
            <p className="step-record">{event.review_response.feedback}</p>
          </div>
        )}
      </>
    );
  return (
    <details className="code-result">
      <summary>Code inputs and outputs</summary>
      <p className="muted">
        {event.code.runtime} · {event.code.duration_ms} ms
      </p>
      <dl>
        <dt>Text output</dt>
        <dd>{event.code.outputs.text}</dd>
        <dt>Number output</dt>
        <dd>{event.code.outputs.number}</dd>
      </dl>
      <pre>{JSON.stringify(event.code.inputs, null, 2)}</pre>
      <p className="code-label">Source SHA-256: {event.code.source_sha256}</p>
    </details>
  );
}

export function RunStepInspector({
  run,
  path,
  states,
  busy,
  feedback,
  changeFeedback,
  onResume,
  select,
}: {
  run: RunSnapshot;
  path: string;
  states: Map<string, StepStatus>;
  busy: boolean;
  feedback: Record<string, string>;
  changeFeedback: (id: string, value: string) => void;
  onResume: ResumeReview;
  select: (path: string) => void;
}) {
  const { node, graph, prefix } = graphLocation(run, path);
  const review = pendingReviews(run).find((item) => reviewPath(item) === path);
  const events = run.events.filter((event) => eventPath(event) === path);
  const passCount =
    run.model_attempts?.filter((attempt) => attemptPath(attempt) === path).length ?? 0;
  const hasAttempt = passCount > 0;
  const status = states.get(path) ?? "Not reached";
  const children = childGraphs(run, node, path, states);
  const inputs = Object.entries(node.inputs ?? {});
  const kind = nodePresentation(node).label;
  const previous = new Set(
    graph.edges.filter((edge) => edge.target === node.id).map((edge) => `${prefix}/${edge.source}`),
  );
  const reviewInputs = review
    ? run.events.filter(
        (event) =>
          previous.has(eventPath(event)) && ["note", "research", "code"].includes(event.kind),
      )
    : [];
  return (
    <section className="run-step-panel" aria-label="Selected step">
      <div className="step-detail-heading">
        <div>
          {kind.toLowerCase() !== node.label.trim().toLowerCase() && (
            <p className="eyebrow">{kind}</p>
          )}
          <h3>{node.label}</h3>
        </div>
        <span className="step-status" data-status={status}>
          {status}
        </span>
      </div>
      {node.config?.type === "research" && node.config.analyst && (
        <p className="field-hint">
          {passCount} of {node.config.analyst.max_passes} research passes used
        </p>
      )}
      {review && (
        <div className={reviewInputs.length ? "run-decision-grid" : undefined}>
          <div className="review-box" aria-label={`Review ${review.node_id}`}>
            <h3>{review.question}</h3>
            <p>
              {review.path && prefix !== "root" && (
                <>
                  {review.path.replaceAll("/", " › ")}
                  <br />
                </>
              )}
              Your decision applies to revision {run.revision_number}.
            </p>
            {run.workflow.schema_version === "0.3" && (
              <label>
                Reviewer feedback
                <textarea
                  rows={3}
                  maxLength={6000}
                  disabled={busy}
                  value={feedback[review.interrupt_id] ?? ""}
                  onChange={(e) => changeFeedback(review.interrupt_id, e.target.value)}
                  placeholder="What should the next step challenge or revise?"
                />
              </label>
            )}
            <div className="actions">
              <Button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  onResume("approve", review.interrupt_id, feedback[review.interrupt_id] ?? "")
                }
              >
                <Check size={15} aria-hidden />
                Approve and continue
              </Button>
              <Button
                className="button"
                disabled={busy}
                onClick={() =>
                  onResume("reject", review.interrupt_id, feedback[review.interrupt_id] ?? "")
                }
              >
                <X size={15} aria-hidden />
                Reject and stop
              </Button>
            </div>
          </div>
          {!!reviewInputs.length && (
            <div className="review-inputs">
              <h4>Output to review</h4>
              {reviewInputs.map((event) =>
                event.kind === "research" ? (
                  <StepResearchResults
                    key={eventPath(event)}
                    run={run}
                    path={eventPath(event)}
                    label={event.label}
                  />
                ) : (
                  <div key={eventPath(event)}>
                    <strong>{event.label}</strong>
                    <StepEvent event={event} />
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      )}
      {hasAttempt && <StepResearchResults run={run} path={path} label={node.label} />}
      {events
        .filter((event) => !hasAttempt || event.kind !== "research")
        .map((event, i) => (
          <StepEvent key={event.path ?? i} event={event} />
        ))}
      {children.length > 0 && (
        <div className="step-subgraphs">
          <h4>Nested workflow</h4>
          {children.map((child) => (
            <button className="button small" key={child.path} onClick={() => select(child.path)}>
              {child.label}
              <ArrowUpRight size={14} aria-hidden />
            </button>
          ))}
        </div>
      )}
      {(node.instructions ||
        inputs.length > 0 ||
        node.config?.type === "code" ||
        node.config?.type === "research") &&
        !review && (
          <details className="step-configuration" open={!hasAttempt && !events.length}>
            <summary>Step instructions and inputs</summary>
            {node.instructions && <p className="step-record">{node.instructions}</p>}
            {node.config?.type === "research" && (
              <dl>
                <div>
                  <dt>Model</dt>
                  <dd>
                    {node.config.model ??
                      run.research_manifest?.settings.model ??
                      run.workflow.research?.model}
                  </dd>
                </div>
                {node.config.analyst && (
                  <>
                    <div>
                      <dt>Maximum research passes</dt>
                      <dd>{node.config.analyst.max_passes}</dd>
                    </div>
                    {node.config.analyst.skill && (
                      <div>
                        <dt>Analyst skill</dt>
                        <dd className="step-record">{node.config.analyst.skill}</dd>
                      </div>
                    )}
                  </>
                )}
              </dl>
            )}
            {node.config?.type === "code" && <pre>{node.config.source}</pre>}
            {!!inputs.length && (
              <dl>
                {inputs.map(([name, value]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>
                      {value.source === "output" && value.node_id ? (
                        <button
                          className="text-link"
                          onClick={() => select(`${prefix}/${value.node_id}`)}
                        >
                          {graph.nodes.find((n) => n.id === value.node_id)?.label ?? value.node_id}{" "}
                          · {value.port}
                        </button>
                      ) : (
                        value.source.replaceAll("_", " ")
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </details>
        )}
    </section>
  );
}
