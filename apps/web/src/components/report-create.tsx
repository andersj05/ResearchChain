"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { api, type RunSnapshot, type RunSummary } from "@/lib/workflow";
import { stableRequestId } from "@/lib/evaluations";
import type { ReportRevision, StyleGuide } from "@/lib/reports";

export function ReportCreateForm({
  styles,
  onCreate,
  onCancel,
}: {
  styles: StyleGuide[];
  onCreate: (record: ReportRevision) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [styleId, setStyleId] = useState(styles[0]?.id ?? "");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runId, setRunId] = useState("");
  const [run, setRun] = useState<RunSnapshot | null>(null);
  const [attemptId, setAttemptId] = useState("");
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
      .catch((e) => {
        if (active) setError(e.message);
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
            value.model_attempts?.filter((a) => a.status === "completed").at(-1)?.id ?? "",
          );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [runId]);
  return (
    <form
      className="report-form"
      aria-label="Create report"
      onSubmit={async (e) => {
        e.preventDefault();
        if (submitting.current) return;
        submitting.current = true;
        setBusy(true);
        setError("");
        const body = { title, run_id: runId, attempt_id: attemptId, style_guide_id: styleId };
        try {
          await onCreate(
            await api<ReportRevision>("reports", { ...body, id: stableRequestId(retry, body) }),
          );
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Unable to create report.");
        } finally {
          submitting.current = false;
          setBusy(false);
        }
      }}
    >
      <h2>Start a report from research</h2>
      <p className="muted">
        Use a completed research result as the first draft. Edit its sections with your pinned style
        guide. Creating a report makes no new model call.
      </p>
      <fieldset disabled={busy}>
        <label>
          Report title
          <input
            required
            maxLength={240}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Recorded research run
          <select
            required
            value={runId}
            onChange={(e) => {
              setRunId(e.target.value);
              setAttemptId("");
              setError("");
            }}
          >
            <option value="">Choose a run</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.workflow_name} · {r.id.slice(0, 8)} · {r.status}
              </option>
            ))}
          </select>
        </label>
        {run?.id === runId && (
          <label>
            Completed research result
            <select required value={attemptId} onChange={(e) => setAttemptId(e.target.value)}>
              <option value="">Choose a completed result</option>
              {run.model_attempts
                ?.filter((a) => a.status === "completed")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.stage} · {a.returned_model ?? a.model} · {a.id.slice(0, 8)}
                  </option>
                ))}
            </select>
          </label>
        )}
        {run?.id === runId && !attemptId && (
          <p className="field-hint">This run has no selected completed research result.</p>
        )}
        <label>
          Pinned style guide
          <select required value={styleId} onChange={(e) => setStyleId(e.target.value)}>
            <option value="">Choose a style guide</option>
            {styles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} · v{s.version}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <Button className="button primary" type="submit" disabled={busy || !attemptId || !styleId}>
          Create report draft
        </Button>
        <Button className="button" disabled={busy} onClick={onCancel}>
          Cancel report creation
        </Button>
      </div>
    </form>
  );
}
