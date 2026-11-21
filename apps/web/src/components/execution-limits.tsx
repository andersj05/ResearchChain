import type { ExecutionBudgets } from "@/lib/workflow";

export const executionDefaults: ExecutionBudgets = {
  max_node_executions: 256,
  max_active_seconds: 120,
  max_concurrency: 4,
};

export function ExecutionLimitFields({
  budgets,
  maxParallelSteps,
  onChange,
}: {
  budgets?: ExecutionBudgets | null;
  maxParallelSteps: number;
  onChange: (budgets: ExecutionBudgets, group: string) => void;
}) {
  const current = budgets ?? executionDefaults;
  return (
    <>
      {(
        [
          ["max_node_executions", "Maximum step executions", 1, 10000],
          ["max_active_seconds", "Maximum active seconds", 0.1, 3600],
          ["max_concurrency", "Maximum parallel steps", 1, maxParallelSteps],
        ] as const
      ).map(([key, label, min, max]) => (
        <label key={key}>
          {label}
          <input
            name={key}
            type="number"
            min={min}
            max={max}
            step={key === "max_active_seconds" ? "any" : 1}
            value={current[key]}
            onChange={(event) =>
              onChange({ ...current, [key]: event.target.valueAsNumber || min }, `budget/${key}`)
            }
          />
        </label>
      ))}
      <p className="field-hint">
        Shared across the entire run, including subgraphs and loops. Time spent waiting for a
        completed human review pause is excluded.
      </p>
    </>
  );
}
