"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { EvaluationCaseView } from "@/components/evaluation-candidates";
import { EvaluationDatasetForm, EvaluationReferenceForm } from "@/components/evaluation-forms";
import { EvaluationReview } from "@/components/evaluation-review";
import { api } from "@/lib/workflow";
import {
  trackLabels,
  type EvaluationArchive,
  type EvaluationBundle,
  type EvaluationCalibration,
  type EvaluationComparison,
  type EvaluationComparisonSummary,
  type EvaluationDataset,
  type EvaluationDatasetSummary,
  type EvaluationReference,
} from "@/lib/evaluations";

type View = "datasets" | "comparisons" | "references" | "calibration" | "archives";
const views: Record<View, string> = {
  datasets: "Datasets",
  comparisons: "Comparisons",
  references: "References",
  calibration: "Judge calibration",
  archives: "Archives",
};

export function EvaluationDesk() {
  const [page, setPage] = useState<View>("datasets");
  const [datasets, setDatasets] = useState<EvaluationDatasetSummary[]>([]);
  const [references, setReferences] = useState<EvaluationReference[]>([]);
  const [comparisons, setComparisons] = useState<EvaluationComparisonSummary[]>([]);
  const [calibration, setCalibration] = useState<EvaluationCalibration[]>([]);
  const [archives, setArchives] = useState<EvaluationArchive[]>([]);
  const [dataset, setDataset] = useState<EvaluationDataset | null>(null);
  const [caseId, setCaseId] = useState("");
  const [comparison, setComparison] = useState<EvaluationComparison | null>(null);
  const [archive, setArchive] = useState<EvaluationArchive | null>(null);
  const [editing, setEditing] = useState(false);
  const [revising, setRevising] = useState<EvaluationDataset>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const importFile = useRef<HTMLInputElement>(null);
  const acting = useRef(false);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [ds, refs, pairs, scores, imported] = await Promise.all([
          api<EvaluationDatasetSummary[]>("evaluations/datasets"),
          api<EvaluationReference[]>("evaluations/references"),
          api<EvaluationComparisonSummary[]>("evaluations/comparisons"),
          api<EvaluationCalibration[]>("evaluations/calibration"),
          api<EvaluationArchive[]>("evaluations/archives"),
        ]);
        const params = new URL(window.location.href).searchParams;
        const datasetId = params.get("dataset");
        const comparisonId = params.get("comparison");
        const saved = datasetId
          ? await api<EvaluationDataset>(`evaluations/datasets/${encodeURIComponent(datasetId)}`)
          : null;
        const review = comparisonId
          ? await api<EvaluationComparison>(
              `evaluations/comparisons/${encodeURIComponent(comparisonId)}`,
            )
          : null;
        if (!active) return;
        setDatasets(ds);
        setReferences(refs);
        setComparisons(pairs);
        setCalibration(scores);
        setArchives(imported);
        if (saved) {
          setDataset(saved);
          setCaseId((previous) =>
            saved.cases.some((item) => item.id === previous)
              ? previous
              : (saved.cases[0]?.id ?? ""),
          );
        }
        if (review) {
          setComparison(review);
          setPage("comparisons");
        }
        setError("");
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : "Unable to load evaluations.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [epoch]);
  function remember(key: "dataset" | "comparison", id: string | null) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set(key, id);
    else url.searchParams.delete(key);
    url.searchParams.set("view", "evaluations");
    window.history.replaceState(null, "", url);
  }
  function openComparison(value: EvaluationComparison) {
    setComparison(value);
    setArchive(null);
    setPage("comparisons");
    remember("comparison", value.id);
  }
  function selectDataset(value: EvaluationDataset) {
    setDataset(value);
    setCaseId(value.cases[0]?.id ?? "");
    setEditing(false);
    setRevising(undefined);
    remember("dataset", value.id);
  }
  function back() {
    setComparison(null);
    setArchive(null);
    remember("comparison", null);
    setEpoch((value) => value + 1);
  }
  async function action(work: () => Promise<void>) {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to complete action.");
    } finally {
      acting.current = false;
      setBusy(false);
    }
  }
  async function importArchive(file: File) {
    if (file.size > 8_000_000) throw new Error("Comparison exports must be at most 8 MB.");
    const bundle: EvaluationBundle = JSON.parse(await file.text());
    const imported = await api<EvaluationArchive>("evaluations/archives", bundle);
    setArchives((items) => [imported, ...items.filter((item) => item.id !== imported.id)]);
    setArchive(imported);
    setMessage("Imported as a read-only archive. Local labels were unchanged.");
  }
  const item = dataset?.cases.find((item) => item.id === caseId);
  return (
    <section className="evaluation-desk" aria-label="Evaluations">
      <header className="evidence-header">
        <div>
          <p className="eyebrow">Quality & feedback</p>
          <h1>Evaluations</h1>
          <p className="muted">Freeze cases. Compare drafts. Learn from human edits.</p>
        </div>
        <Button className="button" disabled={busy} onClick={() => setEpoch((value) => value + 1)}>
          Refresh evaluations
        </Button>
      </header>
      {error && (
        <p className="error eval-banner" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="eval-banner" role="status">
          {message}
        </p>
      )}
      {loading ? (
        <p className="eval-banner" role="status">
          Loading evaluations…
        </p>
      ) : comparison ? (
        <EvaluationReview
          key={comparison.id}
          initial={comparison}
          onSaved={setComparison}
          onBack={back}
        />
      ) : archive ? (
        <EvaluationReview
          key={archive.id}
          initial={archive.bundle.comparison}
          readOnlyArchive
          onBack={back}
        />
      ) : (
        <>
          <nav className="eval-navigation" aria-label="Evaluation views">
            {Object.entries(views).map(([key, label]) => (
              <Button
                className="button"
                aria-pressed={page === key}
                key={key}
                onClick={() => {
                  setPage(key as View);
                  setEditing(false);
                }}
              >
                {label}
              </Button>
            ))}
          </nav>
          {page === "datasets" && (
            <>
              {editing ? (
                <EvaluationDatasetForm
                  key={revising?.id ?? "new"}
                  initial={revising}
                  references={references}
                  onCancel={() => setEditing(false)}
                  onSave={(value) => {
                    selectDataset(value);
                    setEpoch((previous) => previous + 1);
                    setMessage(`Dataset revision ${value.version} saved.`);
                  }}
                />
              ) : (
                <div className="eval-layout">
                  <aside className="eval-list">
                    <Button
                      className="button primary"
                      onClick={() => {
                        setRevising(undefined);
                        setEditing(true);
                      }}
                    >
                      New dataset
                    </Button>
                    <h2>Dataset revisions</h2>
                    {!datasets.length && (
                      <p className="muted">Start with a development case and captured evidence.</p>
                    )}
                    {datasets.map((item) => (
                      <Button
                        key={item.id}
                        className={`source-list-item ${dataset?.id === item.id ? "selected" : ""}`}
                        disabled={busy}
                        onClick={() =>
                          action(async () =>
                            selectDataset(
                              await api<EvaluationDataset>(`evaluations/datasets/${item.id}`),
                            ),
                          )
                        }
                      >
                        <strong>{item.title}</strong>
                        <span>
                          Revision {item.version} · {item.case_count}{" "}
                          {item.case_count === 1 ? "case" : "cases"}
                        </span>
                      </Button>
                    ))}
                  </aside>
                  <main className="eval-main">
                    {dataset && item ? (
                      <>
                        <label className="eval-case-select">
                          Case
                          <select
                            value={caseId}
                            onChange={(event) => setCaseId(event.target.value)}
                          >
                            {dataset.cases.map((item) => (
                              <option value={item.id} key={item.id}>
                                {item.title}
                              </option>
                            ))}
                          </select>
                        </label>
                        <EvaluationCaseView
                          key={`${dataset.id}:${caseId}`}
                          dataset={dataset}
                          item={item}
                          onCompare={openComparison}
                          onRevise={() => {
                            setRevising(dataset);
                            setEditing(true);
                          }}
                        />
                      </>
                    ) : (
                      <div className="eval-empty">
                        <h2>Build a repeatable comparison</h2>
                        <ol>
                          <li>Create a case with a clear brief and allowed evidence.</li>
                          <li>Save two outputs with their generation history.</li>
                          <li>Review the randomized drafts, then inspect provenance.</li>
                        </ol>
                        <p className="field-hint">
                          Frozen-evidence writing and full-research comparisons are tracked
                          separately.
                        </p>
                      </div>
                    )}
                  </main>
                </div>
              )}
            </>
          )}
          {page === "comparisons" && (
            <div className="eval-content">
              <h2>Saved comparisons</h2>
              {!comparisons.length && (
                <p className="muted">
                  Choose two candidate outputs in a dataset case to start a comparison.
                </p>
              )}
              {comparisons.map((item) => (
                <Button
                  key={item.id}
                  className="eval-comparison-row"
                  disabled={busy}
                  onClick={() =>
                    action(async () =>
                      openComparison(
                        await api<EvaluationComparison>(`evaluations/comparisons/${item.id}`),
                      ),
                    )
                  }
                >
                  <strong>{item.title}</strong>
                  <span>
                    {trackLabels[item.track]} · {item.partition} ·{" "}
                    {item.reviewed ? "Reviewed" : "Awaiting review"}
                  </span>
                </Button>
              ))}
            </div>
          )}
          {page === "references" && (
            <div className="eval-content">
              <EvaluationReferenceForm
                onSave={(value) => {
                  setReferences((items) => [
                    value,
                    ...items.filter((item) => item.id !== value.id),
                  ]);
                  setMessage("Reference saved separately from generation inputs.");
                }}
              />
              <h2>Saved references</h2>
              {references.map((item) => (
                <details key={item.id}>
                  <summary>
                    {item.title}
                    {item.development_only ? " · development only" : ""}
                  </summary>
                  <p>
                    {item.author} · {item.origin.replaceAll("_", " ")}
                  </p>
                  <pre>{item.text}</pre>
                </details>
              ))}
            </div>
          )}
          {page === "calibration" && (
            <div className="eval-content">
              <h2>Judge calibration</h2>
              <p className="muted">
                Compare preregistered judge predictions with saved human preferences. Accuracy here
                measures agreement with a reviewer, not factual correctness.
              </p>
              {!calibration.length && (
                <div className="eval-empty">
                  <h3>No eligible calibration data yet</h3>
                  <p>
                    Register an existing judge prediction before a human reviews the same pair.
                    Synthetic fixtures and imported archives do not count.
                  </p>
                </div>
              )}
              {calibration.map((item) => (
                <section
                  className="eval-score"
                  key={`${item.model}:${item.prompt_hash}:${item.prompt_version}:${item.track}:${item.partition}`}
                >
                  <h3>
                    {item.model} · {item.prompt_version}
                  </h3>
                  <p>
                    {trackLabels[item.track]} · {item.partition}
                  </p>
                  <dl>
                    <dt>Eligible labels / distinct cases</dt>
                    <dd>
                      {item.labeled_pairs} / {item.distinct_cases}
                    </dd>
                    <dt>Preference agreement</dt>
                    <dd>
                      {item.accuracy === null
                        ? "Not available"
                        : `${(item.accuracy * 100).toFixed(1)}%`}
                    </dd>
                    <dt>Brier score · lower is better</dt>
                    <dd>
                      {item.brier_score === null ? "Not available" : item.brier_score.toFixed(3)}
                    </dd>
                    <dt>Excluded pairs</dt>
                    <dd>{item.excluded_pairs}</dd>
                  </dl>
                  <strong>
                    {item.ready_for_calibration
                      ? "Minimum sample available for exploratory calibration"
                      : "Insufficient data for calibration"}
                  </strong>
                  <p className="field-hint">{item.note}</p>
                </section>
              ))}
            </div>
          )}
          {page === "archives" && (
            <div className="eval-content">
              <h2>Comparison archives</h2>
              <p className="muted">
                Import a reviewed comparison export to inspect its saved texts, labels and versions.
                Archives remain unverified and never add labels to local calibration. Original
                source files are referenced by content hash and require the original artifact store.
              </p>
              <input
                ref={importFile}
                aria-label="Import comparison JSON"
                hidden
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void action(() => importArchive(file));
                }}
              />
              <Button
                className="button"
                disabled={busy}
                onClick={() => importFile.current?.click()}
              >
                Import comparison JSON
              </Button>
              {archives.map((item) => (
                <Button
                  key={item.id}
                  className="eval-comparison-row"
                  onClick={() => setArchive(item)}
                >
                  <strong>{item.title}</strong>
                  <span>Imported archive · unverified</span>
                </Button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
