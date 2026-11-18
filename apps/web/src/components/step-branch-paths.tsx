import { useState } from "react";
import type { Graph, WorkflowNode } from "@/lib/workflow";
import { branchPaths } from "@/lib/workflow-branch-paths";

export function StepBranchPaths({
  graph,
  step,
  onOpenStep,
}: {
  graph: Graph;
  step: WorkflowNode;
  onOpenStep: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const paths = branchPaths(graph, step);
  if (!paths) return null;
  const { join, joinIssue, branches } = paths;

  return (
    <details
      className="node-advanced branch-paths"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>Branch paths</summary>
      <p className="field-hint">
        {step.kind === "route"
          ? "Only the path matching the condition runs."
          : "All branches run. The join waits for all of them."}
      </p>
      <dl>
        {branches.map(({ name, first, steps, issue }, index) => {
          const label = step.kind === "route" ? `If ${name}` : name || "Unnamed branch";
          return (
            <div key={index}>
              <dt>{label}</dt>
              <dd>
                {first && (
                  <ul aria-label={`${label} steps`}>
                    {[first, ...steps].map((target, position) => (
                      <li key={target.id}>
                        <button
                          className="button small"
                          type="button"
                          onClick={() => onOpenStep(target.id)}
                        >
                          {position === 0 && "First: "}
                          {target.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {issue && <p className="field-hint">{issue}</p>}
              </dd>
            </div>
          );
        })}
      </dl>
      <div>
        {join && (
          <button className="button small" type="button" onClick={() => onOpenStep(join.id)}>
            Paired join: {join.label}
          </button>
        )}
        {joinIssue && <p className="field-hint">{joinIssue}</p>}
      </div>
    </details>
  );
}
