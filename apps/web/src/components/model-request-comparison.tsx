import { useMemo, useState } from "react";
import { contentUrl } from "@/lib/evidence";
import { changedSettings, type SettingChange } from "@/lib/workflow-comparison";
import { defaultPassComparisonLabels, type PassComparisonLabels } from "@/lib/run-inspection";
import {
  ModelInputExcerpt,
  useModelRequestPreview,
  type SavedModelInputs,
  type SavedRequestArtifact,
} from "./model-request-preview";

function inputFields(input: SavedModelInputs) {
  return {
    "Research brief": input.brief,
    "Reviewer feedback": input.feedback,
    "Additional context": input.context,
    "Prior research result": input.priorResult,
    "Saved instructions": input.instructions,
  };
}

function inputChanges(comparison: SavedModelInputs, current: SavedModelInputs) {
  const fields = changedSettings(inputFields(comparison), inputFields(current));
  const before = new Map(comparison.sources.map((source) => [source.id, source]));
  const after = new Map(current.sources.map((source) => [source.id, source]));
  if ([...before.keys()].join() !== [...after.keys()].join()) {
    const evidenceList = ({ sources }: SavedModelInputs) =>
      sources.map(({ id, title }) => `${title} · ${id.slice(0, 8)}`).join("\n");
    fields.push({
      name: "Evidence selection and order",
      before: evidenceList(comparison),
      after: evidenceList(current),
    });
  }
  const sources = [...new Set([...before.keys(), ...after.keys()])].flatMap((id) => {
    const source = after.get(id) ?? before.get(id)!;
    const name = `Evidence · ${source.title} · ${id.slice(0, 8)}`;
    return changedSettings(
      { [name]: before.get(id)?.record },
      { [name]: after.get(id)?.record },
    ).map((change) => ({ ...change, id }));
  });
  return { fields, sources };
}

function InputChange({
  change: { name, before, after },
  labels,
}: {
  change: SettingChange;
  labels: PassComparisonLabels;
}) {
  return (
    <details>
      <summary>{name}</summary>
      <div className="comparison-inputs">
        <section aria-label={`${labels.comparison} input`}>
          <h4>{labels.comparison}</h4>
          {before ? <ModelInputExcerpt value={before} /> : <p className="muted">No saved value</p>}
        </section>
        <section aria-label={`${labels.current} input`}>
          <h4>{labels.current}</h4>
          {after ? <ModelInputExcerpt value={after} /> : <p className="muted">No saved value</p>}
        </section>
      </div>
    </details>
  );
}

function InputDifferences({
  comparison,
  current,
  labels,
}: {
  comparison: SavedModelInputs;
  current: SavedModelInputs;
  labels: PassComparisonLabels;
}) {
  const { fields, sources } = useMemo(
    () => inputChanges(comparison, current),
    [comparison, current],
  );
  if (!fields.length && !sources.length) {
    return <p>The displayed research inputs match.</p>;
  }
  return (
    <>
      {fields.map((change) => (
        <InputChange key={change.name} change={change} labels={labels} />
      ))}
      {sources.length > 0 && (
        <details>
          <summary>Evidence records changed ({sources.length})</summary>
          {sources.map((change) => (
            <InputChange key={change.id} change={change} labels={labels} />
          ))}
        </details>
      )}
    </>
  );
}

function RequestDifferences({
  comparison,
  current,
  labels,
}: {
  comparison: SavedRequestArtifact;
  current: SavedRequestArtifact;
  labels: PassComparisonLabels;
}) {
  const before = useModelRequestPreview(comparison);
  const after = useModelRequestPreview(current);
  if (before.preview === undefined || after.preview === undefined) {
    return <p role="status">Loading saved requests…</p>;
  }
  if (
    !before.preview ||
    !after.preview ||
    typeof before.preview === "string" ||
    typeof after.preview === "string"
  ) {
    const errors = [
      { label: labels.comparison, artifact: comparison, ...before },
      { label: labels.current, artifact: current, ...after },
    ].filter(({ preview }) => !preview || typeof preview === "string");
    return errors.map(({ label, artifact, preview, retry }) => (
      <div key={label}>
        <p role={preview === "failed" ? "alert" : undefined}>
          {label} ·{" "}
          {preview === "failed"
            ? "Saved request could not be loaded."
            : preview === "large"
              ? "Saved request exceeds the inline preview limit."
              : "Saved request has no structured research inputs to compare."}
        </p>
        <div className="actions">
          {preview === "failed" && (
            <button className="button small" type="button" onClick={retry}>
              Retry {label.toLowerCase()} request
            </button>
          )}
          <a className="text-link" href={contentUrl(artifact.id)} download>
            Download {label.toLowerCase()} request
          </a>
        </div>
      </div>
    ));
  }
  return <InputDifferences comparison={before.preview} current={after.preview} labels={labels} />;
}

export function ModelRequestComparison({
  comparison,
  current,
  labels = defaultPassComparisonLabels,
}: {
  comparison: SavedRequestArtifact;
  current: SavedRequestArtifact;
  labels?: PassComparisonLabels;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="research-disclosure saved-model-inputs"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Saved research input changes</summary>
      {open &&
        (comparison.id === current.id ? (
          <p>Both passes have the same saved request.</p>
        ) : (
          <RequestDifferences
            key={`${comparison.id}/${current.id}`}
            comparison={comparison}
            current={current}
            labels={labels}
          />
        ))}
    </details>
  );
}
