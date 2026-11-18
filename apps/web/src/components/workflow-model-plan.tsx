import { useState } from "react";
import { scopeKey, type GraphCrumb } from "@/lib/workflow-editing";
import { workflowModelPlan } from "@/lib/workflow-model-plan";
import type { Workflow } from "@/lib/workflow";
import styles from "./workflow-plan.module.css";

export function WorkflowModelPlan({
  workflow,
  onSelect,
}: {
  workflow: Workflow;
  onSelect: (id: string, path: GraphCrumb[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const steps = open ? workflowModelPlan(workflow) : [];
  const overrides = steps.filter((step) => step.override).length;

  return (
    <details
      className={styles.plan}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Model and tool plan</summary>
      {open &&
        (steps.length ? (
          <>
            <p className="muted">
              {steps.length - overrides} use the workflow model · {overrides}{" "}
              {overrides === 1 ? "override" : "overrides"}
            </p>
            <ul className={styles.list} aria-label="Reachable research steps">
              {steps.map((step) => (
                <li key={`${scopeKey(step.path.at(-1)?.ref ?? null)}/${step.id}`}>
                  <button
                    className={styles.step}
                    type="button"
                    aria-label={`Edit ${step.label} in ${step.location}`}
                    onClick={() => {
                      setOpen(false);
                      onSelect(step.id, step.path);
                    }}
                  >
                    {step.label}
                  </button>
                  <p className="muted">{step.location}</p>
                  <p>
                    <code>{step.model}</code> ·{" "}
                    {step.override ? "Step override" : "Workflow default"}
                  </p>
                  <p className="muted">
                    {step.tools.length ? step.tools.join(" · ") : "Model only"}
                  </p>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted">
            Connect a research step to the workflow to see its model and tools.
          </p>
        ))}
    </details>
  );
}
