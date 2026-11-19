import {
  iterationPeers,
  runStepLabel,
  savedModelOutputs,
  selectedModelOutput,
  type IterationComparison,
} from "@/lib/run-inspection";
import type { RunSnapshot } from "@/lib/workflow";
import { CopyRunLink } from "./copy-run-link";
import { SavedModelPassComparison } from "./run-step-output-comparison";

const labels = { comparison: "Earlier iteration", current: "Later iteration" };

export function RunIterationComparison({
  run,
  selection,
  onChange,
  onBack,
}: {
  run: RunSnapshot;
  selection: IterationComparison;
  onChange: (selection: IterationComparison) => void;
  onBack: () => void;
}) {
  const outputs = savedModelOutputs(run);
  const earlier = outputs.get(selection.comparison.path) ?? [];
  const later = outputs.get(selection.current.path) ?? [];
  const before = earlier.find((pass) => pass.attempt.id === selection.comparison.attemptId);
  const after = later.find((pass) => pass.attempt.id === selection.current.attemptId);
  const earlierPaths = iterationPeers(outputs.keys(), selection.current.path).filter(
    ({ difference }) => difference < 0,
  );
  const laterPaths = iterationPeers(outputs.keys(), selection.comparison.path).filter(
    ({ difference }) => difference > 0,
  );
  const changePath = (side: keyof IterationComparison, path: string) => {
    const pass = selectedModelOutput(outputs.get(path) ?? []);
    if (pass) onChange({ ...selection, [side]: { path, attemptId: pass.attempt.id } });
  };

  return (
    <section className="run-iteration-comparison" aria-label="Compare saved iterations">
      <div className="actions">
        <button type="button" className="button small" onClick={onBack}>
          Back to outputs
        </button>
        {before && after && (
          <CopyRunLink
            key={`${before.attempt.id}/${after.attempt.id}`}
            runId={run.id}
            target="iterations"
            id={`${before.attempt.id},${after.attempt.id}`}
          />
        )}
      </div>
      {before && after ? (
        <>
          <div className="iteration-comparison-choices">
            {(["comparison", "current"] as const).map((side) => (
              <label key={side}>
                {labels[side]}
                <select
                  value={selection[side].path}
                  onChange={(event) => changePath(side, event.target.value)}
                >
                  {(side === "comparison" ? earlierPaths : laterPaths).map(({ path }) => (
                    <option key={path} value={path}>
                      {runStepLabel(run, path)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <SavedModelPassComparison
            labels={labels}
            comparison={{
              run,
              title: labels.comparison,
              path: selection.comparison.path,
              pass: before,
              passes: earlier,
              onSelect: (attemptId) =>
                onChange({ ...selection, comparison: { ...selection.comparison, attemptId } }),
            }}
            current={{
              run,
              title: labels.current,
              path: selection.current.path,
              pass: after,
              passes: later,
              onSelect: (attemptId) =>
                onChange({ ...selection, current: { ...selection.current, attemptId } }),
            }}
          />
        </>
      ) : (
        <p role="status">This saved iteration comparison is unavailable.</p>
      )}
    </section>
  );
}
