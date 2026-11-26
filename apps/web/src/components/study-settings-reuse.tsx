import { useEffect, useState } from "react";
import { formatTime } from "./run-status";
import type { ResearchSessionSetup } from "@/lib/research-sessions";
import { api, type RecentRunSummary } from "@/lib/workflow";
import styles from "./research-desk.module.css";

type SetupRead = { id: string } & ({ setup: ResearchSessionSetup } | { error: string });

export function StudySettingsReuse({
  studies,
  disabled,
  onApply,
}: {
  studies: RecentRunSummary[];
  disabled: boolean;
  onApply: (setup: ResearchSessionSetup) => boolean;
}) {
  const [choice, setChoice] = useState("");
  const [read, setRead] = useState<SetupRead>();
  const [applied, setApplied] = useState(false);
  const selectedId = studies.some((study) => study.id === choice) ? choice : "";
  const current = read?.id === selectedId ? read : undefined;
  const setup = current && "setup" in current ? current.setup : undefined;
  const error = current && "error" in current ? current.error : "";

  useEffect(() => {
    if (!selectedId || disabled || current) return;
    let live = true;
    void api<ResearchSessionSetup>(
      `research-sessions/${encodeURIComponent(selectedId)}/setup`,
    ).then(
      (setup) => {
        if (live) setRead({ id: selectedId, setup });
      },
      (cause: unknown) => {
        if (live)
          setRead({
            id: selectedId,
            error: cause instanceof Error ? cause.message : "Could not read the saved settings.",
          });
      },
    );
    return () => {
      live = false;
    };
  }, [selectedId, disabled, current]);

  return (
    <details className={`${styles.option} ${styles.fullField}`}>
      <summary>Use settings from a study</summary>
      <div className={styles.optionBody}>
        <p className="field-hint">
          Copy the team structure, consultation settings, model choices, thinking effort, response
          detail, and limits into this draft.
        </p>
        <label>
          Saved study
          <select
            value={selectedId}
            disabled={disabled}
            onChange={(event) => {
              setChoice(event.target.value);
              setRead(undefined);
              setApplied(false);
            }}
          >
            <option value="">Choose a recent study</option>
            {studies.map((study) => (
              <option key={study.id} value={study.id}>
                {study.study_title || study.brief_excerpt || study.workflow_name} ·{" "}
                {formatTime(study.created_at)}
              </option>
            ))}
          </select>
        </label>
        {selectedId && !current && !disabled && <p role="status">Reading saved settings…</p>}
        {error && <p role="alert">{error}</p>}
        <div className="actions">
          <button
            className="button small"
            type="button"
            disabled={disabled || !setup}
            onClick={() => {
              if (setup && onApply(setup)) setApplied(true);
            }}
          >
            Use these settings
          </button>
          {error && (
            <button
              type="button"
              className="text-link"
              disabled={disabled}
              onClick={() => setRead(undefined)}
            >
              Retry saved settings
            </button>
          )}
        </div>
        {applied && <p role="status">Research settings copied.</p>}
      </div>
    </details>
  );
}
