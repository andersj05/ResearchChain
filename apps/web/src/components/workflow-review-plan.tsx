import { useState } from "react";
import {
  conditionBindings,
  outputBindings,
  portsFor,
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
      const uniqueStep = (id: string) => graph.nodes.filter((step) => step.id === id).length === 1;
      const inputBindings = [
        ...outputBindings(graph).map((binding) => ({ ...binding, nextIteration: false })),
        ...outputBindings(graph, "previous_iteration").map((binding) => ({
          ...binding,
          nextIteration: true,
        })),
      ];
      const feedback = [
        ...inputBindings.map(({ input, target, ...binding }) => ({
          ...binding,
          target,
          field: input,
          canOpen:
            uniqueStep(target.id) &&
            (target.kind === "note" || target.config?.type === target.kind) &&
            portsFor(target).some(
              (port) =>
                port.name === input && port.direction === "input" && port.type !== "control",
            ),
        })),
        ...conditionBindings(graph).map((binding) => ({
          ...binding,
          field: "condition",
          canOpen: uniqueStep(binding.target.id),
          nextIteration: false,
        })),
      ].filter((binding) => binding.output === "feedback");
      return nodes.flatMap((node) =>
        node.kind === "review" && uniqueStep(node.id)
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
  onSelect: (id: string, path: GraphCrumb[], field?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const reviews = open ? reviewPlan(workflow) : [];
  function openStep(id: string, path: GraphCrumb[], field?: string) {
    setOpen(false);
    onSelect(id, path, field);
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
            {reviews.map(({ node, path, location, previous, bindings }) => {
              const feedback = bindings.length
                ? `${bindings.length} feedback ${bindings.length === 1 ? "binding" : "bindings"}`
                : "No feedback bindings";
              return (
                <li key={`${scopeKey(path.at(-1)?.ref ?? null)}/${node.id}`}>
                  <button
                    className={styles.step}
                    type="button"
                    aria-label={`Edit ${node.label || node.id} in ${location}`}
                    onClick={() => openStep(node.id, path)}
                  >
                    {node.label || node.id}
                  </button>
                  {path.length > 0 && <p className="muted">{location}</p>}
                  {node.instructions && !node.instructions.trim() ? (
                    <p className="muted">Question contains only whitespace.</p>
                  ) : (
                    <p className={styles.question}>
                      {node.instructions || defaultReviewQuestion}
                      {!node.instructions && <span className="muted"> · Default question</span>}
                    </p>
                  )}
                  {previous.length || bindings.length ? (
                    <details className={styles.reviewWiring}>
                      <summary>
                        Wiring <span className="muted">· {feedback}</span>
                      </summary>
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
                      {bindings.length > 0 && (
                        <>
                          <p className="muted">Feedback bindings</p>
                          <ul className={styles.bindings} aria-label="Feedback bindings">
                            {bindings.map(({ target, field, canOpen, nextIteration }, index) => {
                              const label = `${target.label || target.id} · ${field}${
                                nextIteration ? " · next iteration" : ""
                              }`;
                              return (
                                <li key={`${target.id}/${field}/${index}`}>
                                  {canOpen ? (
                                    <button
                                      className={styles.step}
                                      type="button"
                                      aria-label={`Open ${label} in ${location}`}
                                      onClick={() => openStep(target.id, path, field)}
                                    >
                                      {label}
                                    </button>
                                  ) : (
                                    label
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </>
                      )}
                    </details>
                  ) : (
                    <p className="muted">{feedback}</p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">No review steps are reachable from the workflow start.</p>
        ))}
    </details>
  );
}
