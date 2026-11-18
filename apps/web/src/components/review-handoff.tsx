import { conditionBindings, outputBindings } from "@/lib/workflow-editing";
import type { Graph } from "@/lib/workflow";

export function ReviewHandoff({
  graph,
  reviewId,
  onOpenField,
}: {
  graph: Graph;
  reviewId: string;
  onOpenField: (stepId: string, field: string) => void;
}) {
  const predecessors = new Set(
    graph.edges.filter((edge) => edge.target === reviewId).map((edge) => edge.source),
  );
  const previous = graph.nodes.filter((step) => predecessors.has(step.id));
  const usesFeedback = ({ sourceId, output }: { sourceId: string; output: string }) =>
    sourceId === reviewId && output === "feedback";
  const recipients = outputBindings(graph).filter(usesFeedback);
  const conditions = conditionBindings(graph).filter(usesFeedback);

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
                onClick={() => onOpenField(target.id, input)}
              >
                {target.label} · {input}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="field-hint">No step inputs are wired to this feedback.</p>
      )}
      {conditions.length > 0 && (
        <>
          <h3>Conditions using this feedback</h3>
          <ul className="review-recipients" aria-label="Conditions using this feedback">
            {conditions.map(({ target }) => (
              <li key={target.id}>
                <button
                  className="button small"
                  type="button"
                  onClick={() => onOpenField(target.id, "condition")}
                >
                  {target.label} · condition
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </fieldset>
  );
}
