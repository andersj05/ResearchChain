"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { useOwner } from "@/components/access-context";
import { ownerStoragePrefix } from "@/lib/access";
import { api, type RunSnapshot, type RunSummary } from "@/lib/workflow";
import { stableRequestId } from "@/lib/evaluations";
import { sessionUrl } from "@/lib/research-sessions";
import type { ReportCreate, ReportRevision, StyleGuide } from "@/lib/reports";

type StudyOrigin = { runId: string; attemptId: string };
type Pending = { id: string; body: string };

function readStudyPending(key: string, study: StudyOrigin | undefined) {
  if (!study) return null;
  try {
    const pending: Pending = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!pending || typeof pending.body !== "string" || typeof pending.id !== "string") return null;
    const body: Omit<ReportCreate, "id"> = JSON.parse(pending.body);
    if (
      body.run_id === study.runId &&
      body.attempt_id === study.attemptId &&
      body.source_format === "session_markdown" &&
      typeof body.title === "string" &&
      typeof body.style_guide_id === "string"
    )
      return { pending, body };
  } catch {
    // The form remains available when there is no recoverable request.
  }
  return null;
}

export function ReportCreateForm({
  study,
  styles,
  onCreate,
  onCancel,
}: {
  study?: StudyOrigin;
  styles: StyleGuide[];
  onCreate: (record: ReportRevision) => Promise<void>;
  onCancel: () => void;
}) {
  const { owner } = useOwner();
  const recoveryKey = `${ownerStoragePrefix(owner)}.report.study.${study?.attemptId ?? "new"}`;
  const [recovery] = useState(() => readStudyPending(recoveryKey, study));
  const [title, setTitle] = useState(recovery?.body.title ?? "");
  const [styleId, setStyleId] = useState(recovery?.body.style_guide_id ?? styles[0]?.id ?? "");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runId, setRunId] = useState(study?.runId ?? "");
  const [run, setRun] = useState<RunSnapshot | null>(null);
  const [attemptId, setAttemptId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const retry = useRef<Pending | null>(recovery?.pending ?? null);
  useEffect(() => {
    if (study) return;
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
  }, [study]);
  useEffect(() => {
    if (!runId) return;
    let active = true;
    api<RunSnapshot>(`runs/${encodeURIComponent(runId)}`)
      .then((value) => {
        if (active) {
          setRun(value);
          const completed = value.model_attempts?.filter((a) => a.status === "completed") ?? [];
          if (study) {
            const recorded = completed.find((item) => item.id === study.attemptId);
            if (value.status !== "completed" || !recorded) {
              setError("This study's completed report could not be found.");
              return;
            }
            setAttemptId(recorded.id);
            setTitle(
              (current) =>
                current || (value.study_title || value.brief).trim().split("\n")[0]!.slice(0, 240),
            );
          } else setAttemptId(completed.at(-1)?.id ?? "");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [runId, study]);
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
        const body: Omit<ReportCreate, "id"> = {
          title,
          run_id: runId,
          attempt_id: attemptId,
          style_guide_id: styleId,
          ...(study && { source_format: "session_markdown" }),
        };
        try {
          const id = stableRequestId(retry, body);
          if (study) {
            try {
              sessionStorage.setItem(recoveryKey, JSON.stringify(retry.current));
            } catch {
              /* The request ID remains available in this form. */
            }
          }
          await onCreate(await api<ReportRevision>("reports", { ...body, id }));
          if (study) {
            try {
              sessionStorage.removeItem(recoveryKey);
            } catch {
              /* The server has recorded the draft. */
            }
          }
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Unable to create report.");
        } finally {
          submitting.current = false;
          setBusy(false);
        }
      }}
    >
      <h2>{study ? "Draft this study report" : "Start a report from research"}</h2>
      <p className="muted">
        {study
          ? "Bring the saved report and figures into the editor with a pinned style guide."
          : "Use a completed research result as the first draft. Edit its sections with your pinned style guide. Creating a report makes no new model call."}
      </p>
      {study && (
        <p>
          <a href={sessionUrl(study.runId)}>Open original study</a>
        </p>
      )}
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
        {!study && (
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
        )}
        {!study && run?.id === runId && (
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
        {!study && run?.id === runId && !attemptId && (
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
