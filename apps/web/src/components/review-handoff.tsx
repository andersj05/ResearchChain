import { conditionBindings, outputBindings, previousControlSteps } from "@/lib/workflow-editing";
import type { Graph } from "@/lib/workflow";

export function ReviewHandoff({
  graph,
  reviewId,
  onOpenField,
}: {
  graph: Graph;
  reviewId: string;
  onOpenField: (stepId: string, field?: string) => void;
}) {
  const previous = previousControlSteps(graph, reviewId);
  const usesFeedback = ({ sourceId, output }: { sourceId: string; output: string }) =>
    sourceId === reviewId && output === "feedback";
  const recipients = outputBindings(graph).filter(usesFeedback);
  const carried = outputBindings(graph, "previous_iteration").filter(usesFeedback);
  const conditions = conditionBindings(graph).filter(usesFeedback);

  return (
    <fieldset className="config-fields review-handoff">
      <legend>Review handoff</legend>
      <h3>Previous control steps</h3>
      {previous.length ? (
        <ul className="review-recipients" aria-label="Previous control steps">
          {previous.map((step) => (
            <li key={step.id}>
              <button className="button small" type="button" onClick={() => onOpenField(step.id)}>
                {step.label || step.id}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="field-hint">No previous control steps.</p>
      )}
      <h3>Feedback bindings</h3>
      {recipients.length || carried.length ? (
        <ul className="review-recipients" aria-label="Feedback bindings">
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
          {carried.map(({ target, input }) => (
            <li key={`${target.id}/${input}`}>
              <button
                className="button small"
                type="button"
                onClick={() => onOpenField(target.id, input)}
              >
                {target.label} · {input} · next iteration
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
