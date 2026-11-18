import { useState } from "react";
import {
  conditionBindings,
  outputBindings,
  previousControlSteps,
  reachableWorkflowGraphs,
  scopeKey,
  type GraphCrumb,
} from "@/lib/workflow-editing";
import { defaultReviewQuestion, type Workflow } from "@/lib/workflow";
import styles from "./workflow-plan.module.css";

function reviewPlan(workflow: Workflow) {
  return [...reachableWorkflowGraphs(workflow, { controlOnly: true })].flatMap(
    ({ graph, nodes, path }) => {
      const version = path.at(-1)?.ref.version;
      const name = graph.name || (version ? "Subgraph" : "Workflow");
      const location = version ? `${name} · v${version}` : name;
      const feedback = [
        ...outputBindings(graph).map(({ input, ...binding }) => ({ ...binding, field: input })),
        ...conditionBindings(graph).map((binding) => ({ ...binding, field: "condition" })),
      ].filter((binding) => binding.output === "feedback");
      return nodes.flatMap((node) =>
        node.kind === "review" &&
        graph.nodes.filter((candidate) => candidate.id === node.id).length === 1
          ? [
              {
                node,
                path,
                location,
                previous: previousControlSteps(graph, node.id),
                bindings: feedback.filter((binding) => binding.sourceId === node.id),
              },
            ]
          : [],
      );
    },
  );
}

export function WorkflowReviewPlan({
  workflow,
  onSelect,
}: {
  workflow: Workflow;
  onSelect: (id: string, path: GraphCrumb[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const reviews = open ? reviewPlan(workflow) : [];
  function openStep(id: string, path: GraphCrumb[]) {
    setOpen(false);
    onSelect(id, path);
  }
  return (
    <details
      className={styles.plan}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>Review plan</span>
        {reviews.length > 0 && (
          <span className="muted">
            {" "}
            · {reviews.length} {reviews.length === 1 ? "review" : "reviews"}
          </span>
        )}
      </summary>
      {open &&
        (reviews.length ? (
          <ul className={styles.list} aria-label="Reachable review steps">
            {reviews.map(({ node, path, location, previous, bindings }) => (
              <li key={`${scopeKey(path.at(-1)?.ref ?? null)}/${node.id}`}>
                <button
                  className={styles.step}
                  type="button"
                  aria-label={`Edit ${node.label || node.id} in ${location}`}
                  onClick={() => openStep(node.id, path)}
                >
                  {node.label || node.id}
                </button>
                <p className="muted">{location}</p>
                {node.instructions && !node.instructions.trim() ? (
                  <p className="muted">Question contains only whitespace.</p>
                ) : (
                  <p className={styles.question}>
                    {node.instructions || defaultReviewQuestion}
                    {!node.instructions && <span className="muted"> · Default question</span>}
                  </p>
                )}
                {previous.length > 0 && (
                  <>
                    <p className="muted">Previous control steps</p>
                    <ul className={styles.bindings} aria-label="Previous control steps">
                      {previous.map((step) => (
                        <li key={step.id}>
                          <button
                            className={styles.step}
                            type="button"
                            onClick={() => openStep(step.id, path)}
                          >
                            {step.label || step.id}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {bindings.length ? (
                  <>
                    <p className="muted">Feedback bindings</p>
                    <ul className={styles.bindings} aria-label="Feedback bindings">
                      {bindings.map(({ target, field }, index) => (
                        <li key={`${target.id}/${field}/${index}`}>
                          {target.label || target.id} · {field}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="muted">No step inputs or conditions are wired to this feedback.</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No review steps are reachable from the workflow start.</p>
        ))}
    </details>
  );
}
