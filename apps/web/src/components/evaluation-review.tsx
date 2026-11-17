"use client";

import { useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { api } from "@/lib/workflow";
import { contentUrl, evidenceUrl } from "@/lib/evidence";
import { EvaluationCheckSummary } from "@/components/evaluation-candidates";
import {
  downloadEvaluation,
  gateLabels,
  ratingLabels,
  stableRequestId,
  trackLabels,
  type EvaluationBundle,
  type EvaluationComparison,
  type EvaluationEdit,
  type EvaluationFeedbackCreate,
  type EvaluationGates,
  type EvaluationJudge,
  type EvaluationRatings,
} from "@/lib/evaluations";

type Side = "left" | "right";
const sideLabel = { left: "A", right: "B" } as const;
const blankGates = (): EvaluationGates => ({
  factual_accuracy: "unassessed",
  numerical_accuracy: "unassessed",
  citation_support: "unassessed",
  reason: "",
});

function JudgePrediction({ view }: { view: EvaluationComparison }) {
  const [model, setModel] = useState("");
  const [version, setVersion] = useState("");
  const [prompt, setPrompt] = useState("");
  const [reason, setReason] = useState("");
  const [probabilities, setProbabilities] = useState({ left: "", right: "", tie: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const retry = useRef<{ body: string; id: string } | null>(null);
  const submitting = useRef(false);
  async function save() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body = {
        model,
        prompt_version: version,
        prompt,
        reason,
        left_hash: view.left.content_hash,
        right_hash: view.right.content_hash,
        probabilities: {
          left: Number(probabilities.left),
          right: Number(probabilities.right),
          tie: Number(probabilities.tie),
        },
      };
      await api<EvaluationJudge>(`evaluations/comparisons/${view.id}/judges`, {
        ...body,
        id: stableRequestId(retry, body),
      });
      setMessage("Prediction registered before human review. No model was called.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save prediction.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <details className="eval-judge">
      <summary>Register an existing judge prediction</summary>
      <p className="field-hint">
        Optional. Enter a prediction already produced elsewhere, before submitting human feedback.
        Use an independent reviewer to avoid showing them the prediction.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy}>
          <div className="eval-grid">
            <label>
              Judge model
              <input
                required
                value={model}
                maxLength={240}
                onChange={(event) => setModel(event.target.value)}
              />
            </label>
            <label>
              Judge prompt version
              <input
                required
                value={version}
                maxLength={240}
                onChange={(event) => setVersion(event.target.value)}
              />
            </label>
          </div>
          <label>
            Exact judge prompt
            <textarea
              required
              rows={3}
              maxLength={20000}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <div className="eval-grid">
            {(["left", "right", "tie"] as const).map((key) => (
              <label key={key}>
                {key === "tie" ? "Tie probability" : `Draft ${sideLabel[key]} probability`}
                <input
                  required
                  type="number"
                  min={0}
                  max={1}
                  step="any"
                  value={probabilities[key]}
                  onChange={(event) =>
                    setProbabilities({ ...probabilities, [key]: event.target.value })
                  }
                />
              </label>
            ))}
          </div>
          <p className="field-hint">Three probabilities must sum to 1.</p>
          <label>
            Judge reasoning
            <textarea
              required
              rows={2}
              maxLength={6000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <Button className="button" type="submit">
            Register prediction
          </Button>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
      </form>
    </details>
  );
}

export function EvaluationReview({
  initial,
  onSaved,
  onBack,
  readOnlyArchive = false,
}: {
  initial: EvaluationComparison;
  onSaved?: (view: EvaluationComparison) => void;
  onBack: () => void;
  readOnlyArchive?: boolean;
}) {
  const [view, setView] = useState(initial);
  const [preference, setPreference] = useState<EvaluationFeedbackCreate["preference"] | "">("");
  const [reason, setReason] = useState("");
  const [gates, setGates] = useState<Record<Side, EvaluationGates>>({
    left: blankGates(),
    right: blankGates(),
  });
  const [ratings, setRatings] = useState<Record<Side, EvaluationRatings>>({ left: {}, right: {} });
  const [edits, setEdits] = useState<EvaluationEdit[]>([]);
  const [editing, setEditing] = useState<EvaluationEdit | null>(null);
  const [judges, setJudges] = useState<EvaluationJudge[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const leftText = useRef<HTMLTextAreaElement>(null);
  const rightText = useRef<HTMLTextAreaElement>(null);
  const retry = useRef<{ body: string; id: string } | null>(null);
  const acting = useRef(false);
  async function action(work: () => Promise<void>) {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save review.");
    } finally {
      acting.current = false;
      setBusy(false);
    }
  }
  function selectEdit(side: Side) {
    const element = side === "left" ? leftText.current : rightText.current;
    if (!element) return;
    const start = Array.from(element.value.slice(0, element.selectionStart)).length;
    const end = Array.from(element.value.slice(0, element.selectionEnd)).length;
    const original = Array.from(element.value).slice(start, end).join("");
    setEditing({ side, start, end, original, replacement: original, reason: "" });
  }
  function saveEdit() {
    if (!editing || editing.original === editing.replacement || !editing.reason.trim()) return;
    setEdits((items) => [...items, editing]);
    setEditing(null);
  }
  return (
    <section
      className="eval-review"
      aria-label={readOnlyArchive ? "Archived comparison" : "Blind comparison"}
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            {trackLabels[view.track]} · {view.partition}
          </p>
          <h2>{view.title}</h2>
        </div>
        <Button className="button" onClick={onBack}>
          Back to evaluations
        </Button>
      </div>
      {readOnlyArchive && (
        <p className="eval-notice">
          Imported archive · unverified provenance. This label is excluded from local calibration.
        </p>
      )}
      <p className="eval-brief">{view.brief}</p>
      <p className="field-hint">
        {view.as_of_date
          ? `Historical window: ${view.period_start} to ${view.as_of_date}`
          : "No historical cutoff"}
        {view.synthetic ? " · synthetic fixture" : ""}
      </p>
      {!view.feedback && (
        <p className="muted">
          Read both drafts and inspect their sources. Model and workflow details are revealed only
          after you save your judgment.
        </p>
      )}
      <details>
        <summary>Evidence available for review · {view.evidence.length}</summary>
        <ul>
          {view.evidence.map((source) => (
            <li key={source.id}>
              {readOnlyArchive ? (
                source.title
              ) : (
                <a href={evidenceUrl(source.id)} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
              )}{" "}
              · {source.representation ?? "original"}
              {source.as_of_date ? ` · as of ${source.as_of_date}` : ""}
              {!readOnlyArchive && source.artifact && (
                <>
                  {" "}
                  ·{" "}
                  <a href={contentUrl(source.artifact.id)} target="_blank" rel="noreferrer">
                    Original
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
      </details>
      <div className="eval-pair">
        {(["left", "right"] as const).map((side) => (
          <article key={side} className="eval-draft" aria-label={`Draft ${sideLabel[side]} review`}>
            <h3>Draft {sideLabel[side]}</h3>
            <EvaluationCheckSummary checks={view[side].checks} />
            <textarea
              ref={side === "left" ? leftText : rightText}
              aria-label={`Draft ${sideLabel[side]} text`}
              readOnly
              value={view[side].text}
              className="eval-draft-text"
            />
            {!view.feedback && (
              <Button
                className="button small"
                disabled={busy || edits.length >= 50}
                onClick={() => selectEdit(side)}
              >
                Edit selected text in {sideLabel[side]}
              </Button>
            )}
          </article>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!view.feedback && (
        <>
          {editing && (
            <section className="eval-edit" aria-label="Edit a selected span">
              <h3>Edit in draft {sideLabel[editing.side]}</h3>
              <p className="field-hint">
                Offsets {editing.start}–{editing.end} use Unicode characters. Select text above
                before creating another edit.
              </p>
              <label>
                Original span
                <textarea readOnly rows={2} value={editing.original} />
              </label>
              <label>
                Replacement
                <textarea
                  rows={2}
                  maxLength={100000}
                  value={editing.replacement}
                  onChange={(event) => setEditing({ ...editing, replacement: event.target.value })}
                />
              </label>
              <label>
                Edit reason
                <input
                  maxLength={6000}
                  value={editing.reason}
                  onChange={(event) => setEditing({ ...editing, reason: event.target.value })}
                />
              </label>
              <div className="eval-actions">
                <Button
                  className="button"
                  disabled={editing.original === editing.replacement || !editing.reason.trim()}
                  onClick={saveEdit}
                >
                  Add edit
                </Button>
                <Button className="button" onClick={() => setEditing(null)}>
                  Discard edit
                </Button>
              </div>
            </section>
          )}
          {edits.length > 0 && (
            <section>
              <h3>Recorded edits</h3>
              {edits.map((edit, index) => (
                <div className="eval-edit-row" key={index}>
                  <span>
                    Draft {sideLabel[edit.side]} · {edit.start}–{edit.end}: {edit.reason}
                  </span>
                  <Button
                    className="button small"
                    onClick={() =>
                      setEdits((items) => items.filter((_, position) => position !== index))
                    }
                  >
                    Remove edit {index + 1}
                  </Button>
                </div>
              ))}
            </section>
          )}
          <JudgePrediction view={view} />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!preference) return;
              void action(async () => {
                const body = {
                  left_hash: view.left.content_hash,
                  right_hash: view.right.content_hash,
                  preference,
                  reason,
                  origin: "human",
                  left_gates: gates.left,
                  right_gates: gates.right,
                  left_ratings: ratings.left,
                  right_ratings: ratings.right,
                  edits,
                };
                const saved = await api<EvaluationComparison>(
                  `evaluations/comparisons/${view.id}/feedback`,
                  { ...body, id: stableRequestId(retry, body) },
                );
                setView(saved);
                onSaved?.(saved);
              });
            }}
          >
            <fieldset disabled={busy}>
              <h3>Your review</h3>
              <p className="field-hint">
                Quality gates are human judgments. An unassessed or failed gate prevents a draft
                from qualifying, even if you prefer it.
              </p>
              <div className="eval-pair">
                {(["left", "right"] as const).map((side) => (
                  <fieldset key={side} className="eval-grade">
                    <legend>Draft {sideLabel[side]} assessment</legend>
                    {Object.entries(gateLabels).map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <select
                          value={gates[side][key as keyof typeof gateLabels] ?? "unassessed"}
                          onChange={(event) =>
                            setGates({
                              ...gates,
                              [side]: { ...gates[side], [key]: event.target.value },
                            })
                          }
                        >
                          <option value="unassessed">Unassessed</option>
                          <option value="pass">Pass</option>
                          <option value="fail">Fail</option>
                        </select>
                      </label>
                    ))}
                    <label>
                      Gate reasoning
                      <textarea
                        required
                        rows={3}
                        maxLength={6000}
                        value={gates[side].reason}
                        onChange={(event) =>
                          setGates({
                            ...gates,
                            [side]: { ...gates[side], reason: event.target.value },
                          })
                        }
                      />
                    </label>
                    <details>
                      <summary>Writing ratings (optional)</summary>
                      <p className="field-hint">
                        1 = weakest, 5 = strongest. Edit burden: 1 = little editing, 5 = extensive
                        editing.
                      </p>
                      {Object.entries(ratingLabels).map(([key, label]) => (
                        <label key={key}>
                          {label}
                          <select
                            value={ratings[side][key as keyof EvaluationRatings] ?? ""}
                            onChange={(event) =>
                              setRatings({
                                ...ratings,
                                [side]: {
                                  ...ratings[side],
                                  [key]: event.target.value ? Number(event.target.value) : null,
                                },
                              })
                            }
                          >
                            <option value="">Unrated</option>
                            {[1, 2, 3, 4, 5].map((value) => (
                              <option value={value} key={value}>
                                {value}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </details>
                  </fieldset>
                ))}
              </div>
              <label>
                Pairwise preference
                <select
                  required
                  value={preference}
                  onChange={(event) => setPreference(event.target.value as typeof preference)}
                >
                  <option value="">Choose a judgment</option>
                  <option value="left">Prefer draft A</option>
                  <option value="right">Prefer draft B</option>
                  <option value="tie">Tie</option>
                  <option value="abstain">Abstain — insufficient basis</option>
                </select>
              </label>
              <label>
                Preference reason
                <textarea
                  required
                  rows={3}
                  maxLength={6000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <p className="field-hint">
                Saving reveals provenance and permanently records this judgment.
              </p>
              <Button className="button primary" type="submit" disabled={!!editing}>
                Save review and reveal provenance
              </Button>
            </fieldset>
          </form>
        </>
      )}
      {view.feedback && view.reveal && (
        <section className="eval-reveal" aria-label="Revealed provenance">
          <h3>Review saved</h3>
          <p>
            Preference:{" "}
            {view.feedback.preference === "left"
              ? "draft A"
              : view.feedback.preference === "right"
                ? "draft B"
                : view.feedback.preference}
            . {view.feedback.reason}
          </p>
          <p>
            Draft A: {view.feedback.left_qualified ? "qualified" : "not qualified"} · Draft B:{" "}
            {view.feedback.right_qualified ? "qualified" : "not qualified"}
          </p>
          <div className="eval-pair">
            {(["left", "right"] as const).map((side) => {
              const candidate = view.reveal![side];
              return (
                <article key={side}>
                  <h4>
                    Draft {sideLabel[side]} · {candidate.label}
                  </h4>
                  <p>{candidate.provenance.model}</p>
                  <p>
                    {candidate.provenance.verification === "recorded_run"
                      ? "Recorded research run"
                      : "Imported declaration"}{" "}
                    · {candidate.provenance.workflow_version}
                  </p>
                  <details>
                    <summary>Saved versions and hashes</summary>
                    <pre>{JSON.stringify(candidate.provenance, null, 2)}</pre>
                  </details>
                </article>
              );
            })}
          </div>
          <details>
            <summary>Saved gates, ratings and edits</summary>
            <pre>{JSON.stringify(view.feedback, null, 2)}</pre>
          </details>
          {view.reveal.references.map((reference) => (
            <details key={reference.id}>
              <summary>Reference: {reference.title}</summary>
              <p>
                {reference.author} · {reference.origin.replaceAll("_", " ")}
              </p>
              {reference.source_url && (
                <a href={reference.source_url} target="_blank" rel="noreferrer">
                  Original publication
                </a>
              )}
              <pre>{reference.text}</pre>
            </details>
          ))}
          {!readOnlyArchive && (
            <div className="eval-actions">
              <Button
                className="button"
                disabled={busy}
                onClick={() =>
                  action(async () =>
                    downloadEvaluation(
                      `comparison-${view.id}.json`,
                      await api<EvaluationBundle>(`evaluations/comparisons/${view.id}/export`),
                    ),
                  )
                }
              >
                Download comparison
              </Button>
              <Button
                className="button"
                disabled={busy}
                onClick={() =>
                  action(async () =>
                    setJudges(
                      await api<EvaluationJudge[]>(`evaluations/comparisons/${view.id}/judges`),
                    ),
                  )
                }
              >
                Show registered predictions
              </Button>
            </div>
          )}
          {judges && (
            <pre>
              {judges.length
                ? JSON.stringify(judges, null, 2)
                : "No judge predictions were registered before this review."}
            </pre>
          )}
        </section>
      )}
    </section>
  );
}
