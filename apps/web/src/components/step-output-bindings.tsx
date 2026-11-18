import { outputBindings, portsFor } from "@/lib/workflow-editing";
import type { Graph, WorkflowNode } from "@/lib/workflow";

export function StepOutputBindings({
  graph,
  step,
  onOpenInput,
}: {
  graph: Graph;
  step: WorkflowNode;
  onOpenInput: (stepId: string, input: string) => void;
}) {
  const outputs = new Set(
    portsFor(step)
      .filter((port) => port.direction === "output" && port.type !== "control")
      .map((port) => port.name),
  );
  if (!outputs.size) return null;
  const bindings = outputBindings(graph).filter(
    ({ sourceId, output }) => sourceId === step.id && outputs.has(output),
  );

  return (
    <details className="node-advanced step-output-bindings">
      <summary>Output bindings</summary>
      {bindings.length ? (
        <ul className="output-binding-list" aria-label="Step inputs in this graph">
          {bindings.map(({ target, input, output }) => (
            <li key={`${target.id}/${input}`}>
              <button
                className="button small"
                type="button"
                onClick={() => onOpenInput(target.id, input)}
              >
                <span>
                  {output} → {target.label} · {input}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="field-hint">No step inputs in this graph use these outputs.</p>
      )}
    </details>
  );
}
