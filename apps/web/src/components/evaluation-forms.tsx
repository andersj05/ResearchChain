"use client";

import { useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { EvidencePicker } from "@/components/evidence-picker";
import { api } from "@/lib/workflow";
import {
  stableRequestId,
  trackLabels,
  type EvaluationCase,
  type EvaluationDataset,
  type EvaluationReference,
  type EvaluationReferenceCreate,
} from "@/lib/evaluations";

const newCase = (number: number): EvaluationCase => ({
  id: `case-${number}`,
  title: "",
  topic: "",
  partition: "development",
  track: "frozen_writing",
  brief: "",
  evidence_ids: [],
  reference_ids: [],
  synthetic: false,
});

export function EvaluationDatasetForm({
  initial,
  references,
  onSave,
  onCancel,
}: {
  initial?: EvaluationDataset;
  references: EvaluationReference[];
  onSave: (record: EvaluationDataset) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [cases, setCases] = useState<EvaluationCase[]>(initial?.cases ?? [newCase(1)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const retry = useRef<{ body: string; id: string } | null>(null);
  const submitting = useRef(false);
  function update(index: number, changes: Partial<EvaluationCase>) {
    setCases((items) =>
      items.map((item, position) => (position === index ? { ...item, ...changes } : item)),
    );
  }
  async function save() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const body = { title, replaces_id: initial?.id ?? null, cases };
      const record = await api<EvaluationDataset>("evaluations/datasets", {
        ...body,
        id: stableRequestId(retry, body),
      });
      onSave(record);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save dataset.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="eval-form" aria-label="Dataset editor">
      <h2>{initial ? "Save a new dataset revision" : "Create an evaluation dataset"}</h2>
      <p className="muted">
        Freeze the task and source versions. Keep development examples separate from holdout topics
        or periods.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy}>
          <label htmlFor="eval-dataset-title">Dataset title</label>
          <input
            id="eval-dataset-title"
            required
            maxLength={240}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          {cases.map((item, index) => (
            <fieldset className="eval-case-form" key={index}>
              <legend>Case {index + 1}</legend>
              <div className="eval-grid">
                <label>
                  Case title
                  <input
                    required
                    maxLength={240}
                    value={item.title}
                    onChange={(event) => update(index, { title: event.target.value })}
                  />
                </label>
                <label>
                  Case identifier
                  <input
                    required
                    pattern="[a-z][a-z0-9_-]{0,63}"
                    value={item.id}
                    onChange={(event) => update(index, { id: event.target.value })}
                  />
                </label>
                <label>
                  Topic identifier
                  <input
                    required
                    pattern="[a-z][a-z0-9_-]{0,63}"
                    placeholder="portfolio-correlation"
                    value={item.topic}
                    onChange={(event) => update(index, { topic: event.target.value })}
                  />
                </label>
                <label>
                  Partition
                  <select
                    value={item.partition}
                    onChange={(event) =>
                      update(index, {
                        partition: event.target.value as EvaluationCase["partition"],
                      })
                    }
                  >
                    <option value="development">Development</option>
                    <option value="holdout">Holdout</option>
                  </select>
                </label>
                <label>
                  Evaluation track
                  <select
                    value={item.track}
                    onChange={(event) =>
                      update(index, { track: event.target.value as EvaluationCase["track"] })
                    }
                  >
                    {Object.entries(trackLabels).map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Research or writing brief
                <textarea
                  required
                  rows={3}
                  maxLength={10000}
                  value={item.brief}
                  onChange={(event) => update(index, { brief: event.target.value })}
                />
              </label>
              <div className="eval-grid">
                <label>
                  Period start (optional)
                  <input
                    type="date"
                    value={item.period_start ?? ""}
                    onChange={(event) =>
                      update(index, { period_start: event.target.value || null })
                    }
                  />
                </label>
                <label>
                  Historical cutoff (optional)
                  <input
                    type="date"
                    value={item.as_of_date ?? ""}
                    onChange={(event) => update(index, { as_of_date: event.target.value || null })}
                  />
                </label>
              </div>
              <p className="field-hint">
                Provide both dates for historical cases. Captures made after the cutoff cannot
                verify the historical vintage.
              </p>
              <EvidencePicker
                label="Allowed evidence"
                selected={item.evidence_ids}
                onChange={(ids) => update(index, { evidence_ids: ids })}
                disabled={busy}
              />
              <fieldset className="eval-references">
                <legend>Reference outputs · excluded from generation</legend>
                {references.map((reference) => (
                  <label className="eval-check" key={reference.id}>
                    <input
                      type="checkbox"
                      checked={item.reference_ids?.includes(reference.id) ?? false}
                      onChange={(event) =>
                        update(index, {
                          reference_ids: event.target.checked
                            ? [...(item.reference_ids ?? []), reference.id]
                            : item.reference_ids?.filter((id) => id !== reference.id),
                        })
                      }
                    />
                    {reference.title}
                    {reference.development_only ? " · development only" : ""}
                  </label>
                ))}
                {!references.length && (
                  <p className="field-hint">
                    Add reference outputs from the References view before creating a case that uses
                    them.
                  </p>
                )}
              </fieldset>
              <label className="eval-check">
                <input
                  type="checkbox"
                  checked={item.synthetic ?? false}
                  onChange={(event) => update(index, { synthetic: event.target.checked })}
                />
                Synthetic fixture (excluded from calibration)
              </label>
              {cases.length > 1 && (
                <Button
                  className="button small"
                  onClick={() =>
                    setCases((items) => items.filter((_, position) => position !== index))
                  }
                >
                  Remove case {index + 1}
                </Button>
              )}
            </fieldset>
          ))}
          <div className="eval-actions">
            <Button
              className="button"
              disabled={cases.length >= 100}
              onClick={() => setCases((items) => [...items, newCase(items.length + 1)])}
            >
              Add another case
            </Button>
            <Button className="button primary" type="submit">
              Save dataset revision
            </Button>
            <Button className="button" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

export function EvaluationReferenceForm({
  onSave,
}: {
  onSave: (record: EvaluationReference) => void;
}) {
  const [draft, setDraft] = useState<Omit<EvaluationReferenceCreate, "id">>({
    title: "",
    text: "",
    author: "",
    origin: "human_supplied",
    development_only: true,
  });
  const [source, setSource] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const retry = useRef<{ body: string; id: string } | null>(null);
  const submitting = useRef(false);
  async function save() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const body = { ...draft, source_evidence_id: source[0] ?? null };
      const record = await api<EvaluationReference>("evaluations/references", {
        ...body,
        id: stableRequestId(retry, body),
      });
      onSave(record);
      setDraft({
        title: "",
        text: "",
        author: "",
        origin: "human_supplied",
        development_only: true,
      });
      setSource([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save reference.");
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
      <h2>Add a reference output</h2>
      <p className="muted">
        Save text you may use for evaluation. References stay separate from generation inputs and
        appear after review.
      </p>
      <fieldset disabled={busy}>
        <label>
          Reference title
          <input
            required
            maxLength={240}
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>
        <div className="eval-grid">
          <label>
            Author
            <input
              required
              maxLength={240}
              value={draft.author}
              onChange={(event) => setDraft({ ...draft, author: event.target.value })}
            />
          </label>
          <label>
            Reference origin
            <select
              value={draft.origin}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  origin: event.target.value as EvaluationReferenceCreate["origin"],
                })
              }
            >
              <option value="human_supplied">Human supplied</option>
              <option value="human_published">Human published</option>
              <option value="synthetic">Synthetic fixture</option>
            </select>
          </label>
        </div>
        <label>
          Original URL (optional)
          <input
            type="url"
            value={draft.source_url ?? ""}
            onChange={(event) => setDraft({ ...draft, source_url: event.target.value || null })}
          />
        </label>
        <label>
          Reference text
          <textarea
            required
            rows={7}
            maxLength={100000}
            value={draft.text}
            onChange={(event) => setDraft({ ...draft, text: event.target.value })}
          />
        </label>
        <label className="eval-check">
          <input
            type="checkbox"
            checked={draft.development_only ?? false}
            onChange={(event) => setDraft({ ...draft, development_only: event.target.checked })}
          />
          Development only
        </label>
        <details>
          <summary>Associate an existing original (optional)</summary>
          <EvidencePicker
            label="Reference original"
            selected={source}
            onChange={(ids) => setSource(ids.slice(-1))}
          />
        </details>
        <Button className="button primary" type="submit">
          Save reference
        </Button>
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
