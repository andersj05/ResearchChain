import { Button } from "@ui-sdk/react/button";
import { CopyRunLink } from "./copy-run-link";
import { sessionUrl } from "@/lib/research-sessions";
import { ArrowUpRight, Check, X } from "lucide-react";
import type { Graph, RunSnapshot, ValueSource, WorkflowNode } from "@/lib/workflow";
import { outputBindings, portsFor } from "@/lib/workflow-editing";
import {
  attemptPath,
  childGraphs,
  directLoopIteration,
  eventPath,
  feedbackRecipients,
  graphLocation,
  nextLoopIteration,
  pendingReviews,
  previousIterationOutput,
  reviewPath,
  type DirectLoopIteration,
  type StepStatus,
} from "@/lib/run-inspection";
import { StepResearchResults } from "./research-results";
import { nodePresentation } from "./node-kind";
import { latestWorkspaceFiles, RunFiles } from "./run-files";

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

function PreviousIterationSource({
  run,
  graph,
  node,
  input,
  source,
  iteration,
  select,
}: {
  run: RunSnapshot;
  graph: Graph;
  node: WorkflowNode;
  input: string;
  source: ValueSource;
  iteration?: DirectLoopIteration;
  select: (path: string, attemptId?: string) => void;
}) {
  const producers = graph.nodes.filter((step) => step.id === source.node_id);
  const producer = producers.length === 1 ? producers[0] : undefined;
  const port =
    producer &&
    portsFor(producer).find(
      (port) => port.direction === "output" && port.name === source.port && port.type !== "control",
    );
  const inputPort = portsFor(node).find(
    (port) => port.direction === "input" && port.name === input,
  );
  if (!iteration) return "Saved loop iteration unavailable";
  if (!producer || !port || port.type !== inputPort?.type)
    return "Previous iteration source unavailable";
  if (iteration.number === 1) {
    return (
      <span>
        {producer.label} · {port.name} · Initial value in iteration 1 (
        {port.type === "number" ? "0" : "empty text"})
      </span>
    );
  }
  const previous = previousIterationOutput(run, iteration, producer);
  const label = `${producer.label} · ${port.name} · Iteration ${iteration.number - 1}`;
  if (!previous) return <span>{label} (saved output unavailable)</span>;
  return (
    <button
      type="button"
      className="text-link"
      onClick={() => select(previous.path, previous.attemptId)}
    >
      {label}
    </button>
  );
}

export function RunStepInspector({
  run,
  path,
  attemptId,
  states,
  busy,
  feedback,
  changeFeedback,
  onResume,
  onIterateStep,
  onModelActivity,
  select,
}: {
  run: RunSnapshot;
  path: string;
  attemptId?: string;
  states: Map<string, StepStatus>;
  busy: boolean;
  feedback: Record<string, string>;
  changeFeedback: (id: string, value: string) => void;
  onResume: ResumeReview;
  onIterateStep: () => Promise<void>;
  onModelActivity: () => void;
  select: (path: string, attemptId?: string) => void;
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
  const outputs = outputBindings(graph).filter((binding) => binding.sourceId === node.id);
  const nextIterationOutputs = outputBindings(graph, "previous_iteration").filter(
    (binding) => binding.sourceId === node.id,
  );
  const iteration =
    nextIterationOutputs.length ||
    inputs.some(([, source]) => source.source === "previous_iteration")
      ? directLoopIteration(run, path)
      : undefined;
  const next = nextLoopIteration(iteration);
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
  const earlierInputs = new Set<string>();
  for (const event of reviewInputs) {
    let source = graph.nodes.find((item) => item.id === event.node_id)?.inputs?.context;
    while (source?.source === "output" && source.node_id && !earlierInputs.has(source.node_id)) {
      earlierInputs.add(source.node_id);
      source = graph.nodes.find((item) => item.id === source?.node_id)?.inputs?.context;
    }
  }
  const related = graph.nodes.filter((item) => earlierInputs.has(item.id));
  const reviewFilePaths = new Set([
    ...reviewInputs.map(eventPath),
    ...related.map((item) => `${prefix}/${item.id}`),
  ]);
  const reviewFiles = reviewFilePaths.size
    ? [...latestWorkspaceFiles(run)].filter(([, file]) => reviewFilePaths.has(file.path))
    : [];
  const feedbackTargets = review ? feedbackRecipients(graph, node.id) : [];
  const nextFeedbackTargets =
    review && next ? feedbackRecipients(graph, node.id, "previous_iteration") : [];
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
      <div className="actions">
        <Button className="button small" disabled={busy} onClick={onIterateStep}>
          Iterate from this step
        </Button>
        {hasAttempt && (
          <Button className="button small" onClick={onModelActivity}>
            Model activity for this step
          </Button>
        )}
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
            {review.perspective && (
              <>
                <p>
                  <strong>{review.perspective.lead_title} · Working thesis</strong>
                  <br />
                  {review.perspective.thesis}
                </p>
                {!!review.perspective.options?.length && (
                  <p>Suggested perspectives · {review.perspective.options.join(" · ")}</p>
                )}
                {run.research_manifest?.tool_config?.session === "brief-led-1" && (
                  <a
                    href={`${sessionUrl(run.id)}#consultation-${encodeURIComponent(review.interrupt_id)}`}
                  >
                    Open this consultation in the Research desk
                  </a>
                )}
              </>
            )}
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
              <>
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
                {feedbackTargets.length > 0 && (
                  <p className="field-hint">
                    Feedback goes to {feedbackTargets.map((item) => item.label).join(", ")}.
                  </p>
                )}
                {next && nextFeedbackTargets.length > 0 && (
                  <p className="field-hint">
                    If the loop continues, feedback goes to{" "}
                    {nextFeedbackTargets.map((item) => item.label).join(", ")} in iteration{" "}
                    {next.number}.
                  </p>
                )}
              </>
            )}
            <div className="actions">
              <Button
                className="button primary"
                disabled={busy || (!!review.perspective && !feedback[review.interrupt_id]?.trim())}
                onClick={() =>
                  onResume("approve", review.interrupt_id, feedback[review.interrupt_id] ?? "")
                }
              >
                <Check size={15} aria-hidden />
                {review.perspective ? "Send perspective to lead" : "Approve and continue"}
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
              {run.checkpoint_id && (
                <CopyRunLink
                  key={`${run.checkpoint_id}/${review.interrupt_id}`}
                  runId={run.id}
                  target="review"
                  id={review.interrupt_id}
                  checkpointId={run.checkpoint_id}
                />
              )}
            </div>
          </div>
          {!!reviewInputs.length && (
            <div className="review-inputs">
              <h4>Output to review</h4>
              {!!related.length && (
                <details className="review-earlier-inputs">
                  <summary>Earlier evidence and analysis</summary>
                  <ul>
                    {related.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => select(`${prefix}/${item.id}`)}
                        >
                          {item.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {reviewFiles.length > 0 && (
                <details className="review-workspace-files">
                  <summary>Files for this review ({reviewFiles.length})</summary>
                  <RunFiles
                    run={run}
                    files={reviewFiles}
                    inspect={select}
                    showFilter={reviewFiles.length > 6}
                  />
                </details>
              )}
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
      {hasAttempt && (
        <StepResearchResults
          key={`${path}:${attemptId ?? "latest"}`}
          run={run}
          path={path}
          label={node.label}
          attemptId={attemptId}
        />
      )}
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
      {(inputs.length > 0 || outputs.length > 0 || nextIterationOutputs.length > 0) && (
        <details className="step-configuration step-bindings">
          <summary>Data bindings</summary>
          {inputs.length > 0 && (
            <section aria-labelledby="step-input-bindings">
              <h4 id="step-input-bindings">Connected inputs</h4>
              <dl>
                {inputs.map(([name, value]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>
                      {value.source === "output" && value.node_id ? (
                        <button
                          className="text-link"
                          type="button"
                          onClick={() => select(`${prefix}/${value.node_id}`)}
                        >
                          {graph.nodes.find((item) => item.id === value.node_id)?.label ??
                            value.node_id}
                          {" · "}
                          {value.port}
                        </button>
                      ) : value.source === "previous_iteration" ? (
                        <PreviousIterationSource
                          run={run}
                          graph={graph}
                          node={node}
                          input={name}
                          source={value}
                          iteration={iteration}
                          select={select}
                        />
                      ) : (
                        value.source.replaceAll("_", " ")
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {outputs.length > 0 && (
            <section aria-labelledby="step-output-bindings">
              <h4 id="step-output-bindings">Connected outputs</h4>
              <dl>
                {outputs.map(({ target, input, output }) => (
                  <div key={`${target.id}/${input}`}>
                    <dt>{output}</dt>
                    <dd>
                      <button
                        className="text-link"
                        type="button"
                        onClick={() => select(`${prefix}/${target.id}`)}
                      >
                        {target.label} · {input}
                      </button>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {nextIterationOutputs.length > 0 && (
            <section aria-labelledby="step-next-iteration-bindings">
              <h4 id="step-next-iteration-bindings">Next iteration bindings</h4>
              <dl>
                {nextIterationOutputs.map(({ target, input, output }) => {
                  const nextPath = next && `${next.prefix}/${target.id}`;
                  const label = `${target.label} · ${input}`;
                  return (
                    <div key={`${target.id}/${input}`}>
                      <dt>{output}</dt>
                      <dd>
                        {next && nextPath && states.has(nextPath) ? (
                          <button
                            type="button"
                            className="text-link"
                            onClick={() => select(nextPath)}
                          >
                            {label} · Iteration {next.number}
                          </button>
                        ) : (
                          <span>{label} (no recorded use in the next iteration)</span>
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          )}
        </details>
      )}
      {(node.instructions || node.config?.type === "code" || node.config?.type === "research") &&
        !review && (
          <details className="step-configuration" open={!hasAttempt && !events.length}>
            <summary>Step instructions and settings</summary>
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
          </details>
        )}
    </section>
  );
}
