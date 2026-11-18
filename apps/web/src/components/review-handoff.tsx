import { outputBindings } from "@/lib/workflow-editing";
import type { Graph } from "@/lib/workflow";

export function ReviewHandoff({
  graph,
  reviewId,
  onOpenInput,
}: {
  graph: Graph;
  reviewId: string;
  onOpenInput: (stepId: string, input: string) => void;
}) {
  const predecessors = new Set(
    graph.edges.filter((edge) => edge.target === reviewId).map((edge) => edge.source),
  );
  const previous = graph.nodes.filter((step) => predecessors.has(step.id));
  const recipients = outputBindings(graph).filter(
    ({ sourceId, output }) => sourceId === reviewId && output === "feedback",
  );

  return (
    <fieldset className="config-fields review-handoff">
      <legend>Review handoff</legend>
      <h3>Previous control steps</h3>
      {previous.length ? (
        <ul>
          {previous.map((step) => (
            <li key={step.id}>{step.label}</li>
          ))}
        </ul>
      ) : (
        <p className="field-hint">No previous control steps.</p>
      )}
      <h3>Feedback bindings</h3>
      {recipients.length ? (
        <ul className="review-recipients">
          {recipients.map(({ target, input }) => (
            <li key={`${target.id}/${input}`}>
              <button
                className="button small"
                type="button"
                onClick={() => onOpenInput(target.id, input)}
              >
                {target.label} · {input}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="field-hint">No step inputs are wired to this feedback.</p>
      )}
    </fieldset>
  );
}
