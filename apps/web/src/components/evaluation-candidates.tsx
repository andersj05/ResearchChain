"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { EvidencePicker } from "@/components/evidence-picker";
import { api, type RunSnapshot, type RunSummary } from "@/lib/workflow";
import { contentUrl, evidenceUrl } from "@/lib/evidence";
import {
  downloadEvaluation,
  evaluationCasePath,
  stableRequestId,
  trackLabels,
  type EvaluationCandidate,
  type EvaluationCase,
  type EvaluationChecks,
  type EvaluationComparison,
  type EvaluationDataset,
  type EvaluationInputs,
  type ImportedEvaluationOutput,
} from "@/lib/evaluations";

export function EvaluationCheckSummary({ checks }: { checks: EvaluationChecks }) {
  return (
    <details className="eval-checks">
      <summary>{checks.eligible ? "Input checks passed" : "Input checks need attention"}</summary>
      <p className="field-hint">
        Metadata and copied-reference checks only. They do not verify truth or detect every
        paraphrase.
      </p>
      {(
        [
          ["reference_exclusion", "Reference exclusion"],
          ["historical_cutoff", "Historical cutoff"],
          ["input_match", "Required evidence"],
        ] as const
      ).map(([key, label]) => (
        <div key={key}>
          <strong>
            {label}: {checks[key].status.replaceAll("_", " ")}
          </strong>
          {checks[key].findings.map((finding, index) => (
            <p key={index}>{finding}</p>
          ))}
        </div>
      ))}
    </details>
  );
}

function CandidateForm({
  dataset,
  item,
  onSave,
  onCancel,
}: {
  dataset: EvaluationDataset;
  item: EvaluationCase;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState("run");
  const [label, setLabel] = useState("");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runId, setRunId] = useState("");
  const [run, setRun] = useState<RunSnapshot | null>(null);
  const [attemptId, setAttemptId] = useState("");
  const [draft, setDraft] = useState<ImportedEvaluationOutput>({
    type: "imported",
    text: "",
    origin: "model",
    model: "",
    workflow_version: "",
    prompt_version: "",
    tool_version: "",
    evidence_ids: item.evidence_ids,
    generation_input: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const retry = useRef<{ body: string; id: string } | null>(null);
  useEffect(() => {
    let active = true;
    api<RunSummary[]>("runs")
      .then((items) => {
        if (active) setRuns(items);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load runs.");
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!runId) return;
    let active = true;
    api<RunSnapshot>(`runs/${encodeURIComponent(runId)}`)
      .then((value) => {
        if (active) {
          setRun(value);
          setAttemptId(
            value.model_attempts?.filter((attempt) => attempt.status === "completed").at(-1)?.id ??
              "",
          );
        }
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load run.");
      });
    return () => {
      active = false;
    };
  }, [runId]);
  async function save() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const source = mode === "run" ? { type: "run", run_id: runId, attempt_id: attemptId } : draft;
      const body = { dataset_id: dataset.id, case_id: item.id, label, source };
      await api<EvaluationCandidate>("evaluations/candidates", {
        ...body,
        id: stableRequestId(retry, body),
      });
      onSave();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save candidate.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className="eval-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h3>Add a candidate output</h3>
      <p className="field-hint">Pin an existing output. This action does not run a model.</p>
      <fieldset disabled={busy}>
        <label>
          Candidate label
          <input
            required
            maxLength={240}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label>
          Output source
          <select value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="run">Completed research attempt</option>
            <option value="imported">Paste an existing draft</option>
          </select>
        </label>
        {mode === "run" ? (
          <>
            <label>
              Recorded run
              <select
                required
                value={runId}
                onChange={(event) => {
                  setRunId(event.target.value);
                  setAttemptId("");
                }}
              >
                <option value="">Choose a run</option>
                {runs.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.workflow_name} · {item.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            {run?.id === runId && (
              <label>
                Completed attempt
                <select
                  required
                  value={attemptId}
                  onChange={(event) => setAttemptId(event.target.value)}
                >
                  <option value="">Choose a completed attempt</option>
                  {run.model_attempts
                    ?.filter((attempt) => attempt.status === "completed")
                    .map((attempt) => (
                      <option value={attempt.id} key={attempt.id}>
                        {attempt.stage} · {attempt.model}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <p className="field-hint">
              The saved run brief must match this case. Workflow, prompts, model and captured
              evidence are recorded automatically.
            </p>
          </>
        ) : (
          <>
            <label>
              Candidate text
              <textarea
                required
                rows={7}
                maxLength={100000}
                value={draft.text}
                onChange={(event) => setDraft({ ...draft, text: event.target.value })}
              />
            </label>
            <div className="eval-grid">
              <label>
                Output origin
                <select
                  value={draft.origin}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      origin: event.target.value as ImportedEvaluationOutput["origin"],
                    })
                  }
                >
                  <option value="model">Model generated</option>
                  <option value="human">Human written</option>
                  <option value="synthetic">Synthetic fixture</option>
                </select>
              </label>
              {(
                [
                  ["model", "Model or author"],
                  ["workflow_version", "Workflow version"],
                  ["prompt_version", "Prompt version"],
                  ["tool_version", "Tool / data process version"],
                ] as const
              ).map(([key, title]) => (
                <label key={key}>
                  {title}
                  <input
                    required
                    maxLength={240}
                    value={draft[key]}
                    onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                  />
                </label>
              ))}
            </div>
            <label>
              Complete generation input
              <textarea
                required
                rows={5}
                maxLength={200000}
                value={draft.generation_input}
                onChange={(event) => setDraft({ ...draft, generation_input: event.target.value })}
              />
            </label>
            <p className="field-hint">
              Include the full prompt and supplied context. Imported versions and inputs are
              declarations; the app cannot verify an external generation history.
            </p>
            <EvidencePicker
              label="Evidence used by this candidate"
              selected={draft.evidence_ids}
              onChange={(ids) => setDraft({ ...draft, evidence_ids: ids })}
              disabled={busy}
            />
          </>
        )}
        <div className="eval-actions">
          <Button className="button primary" type="submit" disabled={mode === "run" && !attemptId}>
            Save candidate
          </Button>
          <Button className="button" onClick={onCancel}>
            Cancel candidate
          </Button>
        </div>
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function EvaluationCaseView({
  dataset,
  item,
  onCompare,
  onRevise,
}: {
  dataset: EvaluationDataset;
  item: EvaluationCase;
  onCompare: (view: EvaluationComparison) => void;
  onRevise: () => void;
}) {
  const [candidates, setCandidates] = useState<EvaluationCandidate[]>([]);
  const [checks, setChecks] = useState<EvaluationChecks | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const retry = useRef<{ body: string; id: string } | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([
      api<EvaluationCandidate[]>(evaluationCasePath(dataset.id, item.id, "candidates")),
      api<EvaluationChecks>(evaluationCasePath(dataset.id, item.id, "checks")),
    ])
      .then(([saved, checked]) => {
        if (active) {
          setCandidates(saved);
          setChecks(checked);
          setError("");
        }
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load case.");
      });
    return () => {
      active = false;
    };
  }, [dataset.id, item.id, epoch]);
  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to complete action.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="eval-case" aria-label="Evaluation case">
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            {item.partition} · {trackLabels[item.track]}
          </p>
          <h2>{item.title}</h2>
        </div>
        <Button className="button small" onClick={onRevise}>
          Revise dataset
        </Button>
      </div>
      <p className="eval-brief">{item.brief}</p>
      <p className="field-hint">
        {dataset.title} · revision {dataset.version}
        {item.as_of_date
          ? ` · ${item.period_start} to ${item.as_of_date}`
          : " · no historical cutoff"}
        {item.synthetic ? " · synthetic fixture" : ""}
      </p>
      {checks && <EvaluationCheckSummary checks={checks} />}
      <div className="eval-actions">
        <Button
          className="button"
          disabled={busy || !checks?.eligible}
          onClick={() =>
            action(async () =>
              downloadEvaluation(
                `inputs-${item.id}.json`,
                await api<EvaluationInputs>(evaluationCasePath(dataset.id, item.id, "inputs")),
              ),
            )
          }
        >
          Download generation inputs
        </Button>
        <Button className="button" disabled={busy} onClick={() => setEpoch((value) => value + 1)}>
          Refresh case
        </Button>
      </div>
      <p className="field-hint">
        Generation packets include complete captured text. Images and PDFs remain linked by content
        hash; inspect the originals below.
      </p>
      <details>
        <summary>Allowed evidence · {item.evidence_ids.length}</summary>
        <ul>
          {item.evidence_ids.map((id) => (
            <li key={id}>
              <a href={evidenceUrl(id)} target="_blank" rel="noreferrer">
                Inspect source {id.slice(0, 8)}
              </a>
            </li>
          ))}
        </ul>
      </details>
      {adding ? (
        <CandidateForm
          dataset={dataset}
          item={item}
          onSave={() => {
            setAdding(false);
            setEpoch((value) => value + 1);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <>
          <div className="section-heading">
            <h3>Candidate outputs</h3>
            <Button className="button" onClick={() => setAdding(true)}>
              Add candidate
            </Button>
          </div>
          <p className="field-hint">
            Select two outputs. Their assignment is randomized and provenance stays hidden until a
            review is submitted. Content itself may identify its author.
          </p>
          {!candidates.length && (
            <p className="muted">
              No candidates yet. Save a completed run or paste an existing draft.
            </p>
          )}
          {candidates.map((candidate) => (
            <div className="eval-candidate" key={candidate.id}>
              <label className="eval-check">
                <input
                  type="checkbox"
                  checked={selected.includes(candidate.id)}
                  disabled={!selected.includes(candidate.id) && selected.length === 2}
                  onChange={(event) =>
                    setSelected((ids) =>
                      event.target.checked
                        ? [...ids, candidate.id]
                        : ids.filter((id) => id !== candidate.id),
                    )
                  }
                />
                {candidate.label}
              </label>
              <span className="field-hint">
                {candidate.provenance.model} ·{" "}
                {candidate.provenance.verification === "recorded_run"
                  ? "Recorded run"
                  : "Declared import"}
              </span>
              <EvaluationCheckSummary checks={candidate.checks} />
              <a href={contentUrl(candidate.artifact_id)} target="_blank" rel="noreferrer">
                Saved output
              </a>
            </div>
          ))}
          <Button
            className="button primary"
            disabled={busy || selected.length !== 2}
            onClick={() =>
              action(async () => {
                const body = { candidate_ids: selected };
                onCompare(
                  await api<EvaluationComparison>("evaluations/comparisons", {
                    ...body,
                    id: stableRequestId(retry, body),
                  }),
                );
              })
            }
          >
            Create blind comparison
          </Button>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
