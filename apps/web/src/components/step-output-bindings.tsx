import { useState } from "react";
import { conditionBindings, outputBindings, portsFor } from "@/lib/workflow-editing";
import type { Graph, WorkflowNode } from "@/lib/workflow";

export function StepOutputBindings({
  graph,
  step,
  onOpenField,
}: {
  graph: Graph;
  step: WorkflowNode;
  onOpenField: (stepId: string, field: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const outputs = new Set(
    portsFor(step)
      .filter((port) => port.direction === "output" && port.type !== "control")
      .map((port) => port.name),
  );
  if (!outputs.size) return null;
  const usesOutput = ({ sourceId, output }: { sourceId: string; output: string }) =>
    sourceId === step.id && outputs.has(output);
  const bindings = outputBindings(graph).filter(usesOutput);
  const carried = outputBindings(graph, "previous_iteration").filter(usesOutput);
  const conditions = conditionBindings(graph).filter(usesOutput);

  return (
    <details
      className="node-advanced step-output-bindings"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>Output bindings</summary>
      {bindings.length > 0 && (
        <ul className="output-binding-list" aria-label="Step inputs in this graph">
          {bindings.map(({ target, input, output }) => (
            <li key={`${target.id}/${input}`}>
              <button
                className="button small"
                type="button"
                onClick={() => onOpenField(target.id, input)}
              >
                <span>
                  {output} → {target.label} · {input}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {conditions.length > 0 && (
        <ul className="output-binding-list" aria-label="Conditions in this graph">
          {conditions.map(({ target, output }) => (
            <li key={target.id}>
              <button
                className="button small"
                type="button"
                onClick={() => onOpenField(target.id, "condition")}
              >
                {output} → {target.label} · condition
              </button>
            </li>
          ))}
        </ul>
      )}
      {carried.length > 0 && (
        <ul className="output-binding-list" aria-label="Inputs in the next iteration">
          {carried.map(({ target, input, output }) => (
            <li key={`${target.id}/${input}`}>
              <button
                className="button small"
                type="button"
                onClick={() => onOpenField(target.id, input)}
              >
                {output} → {target.label} · {input} · next iteration
              </button>
            </li>
          ))}
        </ul>
      )}
      {!bindings.length && !conditions.length && !carried.length && (
        <p className="field-hint">No step inputs or conditions in this graph use these outputs.</p>
      )}
    </details>
  );
}
