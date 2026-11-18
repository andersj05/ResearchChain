import { useState } from "react";
import type { ModelCatalog } from "@/components/model-picker";
import { scopeKey, type GraphCrumb } from "@/lib/workflow-editing";
import { workflowModelPlan } from "@/lib/workflow-model-plan";
import type { Workflow } from "@/lib/workflow";
import styles from "./workflow-plan.module.css";

export function WorkflowModelPlan({
  workflow,
  catalog,
  onSelect,
}: {
  workflow: Workflow;
  catalog: ModelCatalog;
  onSelect: (id: string, path: GraphCrumb[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const { status, loading, error } = catalog;
  const listed =
    open &&
    !loading &&
    !error &&
    status?.models &&
    !status.error &&
    status.accounts.some((account) => account.active && account.signed_in && account.plan_enabled)
      ? new Set(status.models.map((model) => model.slug))
      : undefined;
  const steps = open
    ? workflowModelPlan(workflow).map((step) => ({
        ...step,
        unlisted: !!(listed && step.model && !listed.has(step.model)),
      }))
    : [];
  const overrides = steps.filter((step) => step.override).length;
  const unlisted = steps.filter((step) => step.unlisted).length;
  const catalogMessage = loading
    ? "Checking the model catalog…"
    : !listed
      ? "Model catalog unavailable. Connect or refresh in Run workflow."
      : unlisted
        ? `${unlisted} ${unlisted === 1 ? "step uses" : "steps use"} an unlisted model.`
        : "";

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
            {catalogMessage && <p role="status">{catalogMessage}</p>}
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
                    {step.unlisted && (
                      <>
                        {" "}
                        · <strong>Unlisted for this account</strong>
                      </>
                    )}
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
