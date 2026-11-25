import { useState } from "react";
import type { RunSnapshot } from "@/lib/workflow";
import { readReviewDrafts, storeReviewDrafts } from "@/lib/run-review-drafts";
import type { SessionWorkspace } from "@/lib/swarm-workspaces";
import { focusSessionWorkspace } from "./research-session-workspace";
import styles from "./research-session.module.css";

type Review = NonNullable<RunSnapshot["review"]>;
type Selection = (workspace: string, pass: string | null) => void;

export function rememberAnswer(key: string, id: string, value: string) {
  const drafts = readReviewDrafts(key);
  if (value) drafts[id] = value;
  else delete drafts[id];
  storeReviewDrafts(key, JSON.stringify(drafts));
}

export function SessionWorkspaceLink({
  runId,
  lane,
  pass = null,
  onSelect,
  children,
}: {
  runId: string;
  lane: SessionWorkspace;
  pass?: string | null;
  onSelect: Selection;
  children: React.ReactNode;
}) {
  const params = new URLSearchParams({ session: runId, workspace: lane.key });
  if (pass) params.set("pass", pass);
  return (
    <a
      href={`/?${params}#current-research-workspace`}
      onClick={(event) => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        onSelect(lane.key, pass);
        focusSessionWorkspace();
      }}
    >
      {children}
    </a>
  );
}

export function LeadConsultation({
  review,
  runId,
  lanes,
  draftKey,
  onSelect,
  onAnswer,
  disabled,
}: {
  review: Review;
  runId: string;
  lanes: SessionWorkspace[];
  draftKey: string;
  onSelect: Selection;
  onAnswer: (text: string) => Promise<void>;
  disabled: boolean;
}) {
  const request = review.perspective!;
  const [text, setText] = useState(() => readReviewDrafts(draftKey)[review.interrupt_id] ?? "");
  const id = `consultation-${review.interrupt_id}`;
  const lead = lanes.find((lane) =>
    lane.attempts.some((attempt) => attempt.path === request.action_path),
  );
  const turn = lead?.attempts.find((attempt) => attempt.path === request.action_path);
  const supporting = (request.worker_paths ?? []).flatMap((path) => {
    const lane = lanes.find(
      (item) =>
        item.parentKey === lead?.key && item.attempts.some((attempt) => attempt.path === path),
    );
    const pass = lane?.attempts.find((attempt) => attempt.path === path);
    return lane && pass ? [{ lane, pass }] : [];
  });
  function edit(value: string) {
    setText(value);
    rememberAnswer(draftKey, review.interrupt_id, value);
  }
  return (
    <section className={styles.judgment} id={id} aria-labelledby={id + "-title"} tabIndex={-1}>
      <h2 id={id + "-title"}>{request.lead_title} requests your perspective</h2>
      <h3>{request.question}</h3>
      <p>
        <strong>Working thesis</strong> · {request.thesis}
      </p>
      {lead && turn && (
        <div className={styles.receiptLinks}>
          <SessionWorkspaceLink runId={runId} lane={lead} pass={turn.id} onSelect={onSelect}>
            Inspect the lead’s work
          </SessionWorkspaceLink>
          {supporting.map(({ lane, pass }) => (
            <SessionWorkspaceLink
              key={pass.id}
              runId={runId}
              lane={lane}
              pass={pass.id}
              onSelect={onSelect}
            >
              {lane.title} · Pass {lane.attempts.indexOf(pass) + 1}
            </SessionWorkspaceLink>
          ))}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim() && !disabled) void onAnswer(text.trim());
        }}
      >
        {!!request.options?.length && (
          <fieldset className={styles.suggestions} disabled={disabled}>
            <legend>Suggested perspectives</legend>
            {request.options.map((option) => (
              <button
                key={option}
                type="button"
                className="button small"
                aria-pressed={text === option}
                onClick={() => edit(option)}
              >
                {option}
              </button>
            ))}
          </fieldset>
        )}
        <label htmlFor={id + "-answer"}>Your perspective</label>
        <textarea
          id={id + "-answer"}
          required
          maxLength={6000}
          rows={3}
          value={text}
          disabled={disabled}
          onChange={(event) => edit(event.target.value)}
        />
        <button className="button primary" type="submit" disabled={disabled || !text.trim()}>
          Send perspective to lead
        </button>
      </form>
    </section>
  );
}

export function ConsultationHistory({
  run,
  lanes,
  onSelect,
}: {
  run: RunSnapshot;
  lanes: SessionWorkspace[];
  onSelect: Selection;
}) {
  const answers = run.perspective_answers ?? [];
  if (!answers.length) return null;
  return (
    <details className={styles.settings}>
      <summary>Recorded expert perspectives ({answers.length})</summary>
      <ol className={styles.answerHistory}>
        {answers.map((answer) => {
          const lead = lanes.find(
            (lane) =>
              lane.role === "lead" &&
              lane.attempts.some((turn) => turn.path === answer.action_path),
          );
          const index = lead?.attempts.findIndex((turn) => turn.path === answer.action_path) ?? -1;
          const turn = lead?.attempts[index];
          const next = lead?.attempts[index + 1];
          const action = turn?.result?.swarm_action;
          const assignments = next ? lanes.filter((lane) => lane.issuedBy === next.id) : [];
          return (
            <li key={answer.interrupt_id}>
              <strong>{lead?.title ?? answer.action_path}</strong>
              {action?.action === "ask_expert" && <p>{action.consultation.question}</p>}
              <p>{answer.feedback}</p>
              {!!assignments.length && (
                <section aria-label="Assignments after your perspective">
                  <h4>Assignments after your perspective</h4>
                  <ul className={styles.assignments}>
                    {assignments.map((lane) => {
                      const pass = lane.attempts.find((attempt) => attempt.input_artifact_id);
                      return (
                        <li key={lane.key}>
                          <strong>{lane.title}</strong>
                          <p>{lane.objective}</p>
                          {pass && (
                            <SessionWorkspaceLink
                              runId={run.id}
                              lane={lane}
                              pass={pass.id}
                              onSelect={onSelect}
                            >
                              Inspect researcher request
                            </SessionWorkspaceLink>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
              {lead && turn && (
                <div className={styles.receiptLinks}>
                  <SessionWorkspaceLink
                    runId={run.id}
                    lane={lead}
                    pass={turn.id}
                    onSelect={onSelect}
                  >
                    Original consultation
                  </SessionWorkspaceLink>
                  {next && (
                    <SessionWorkspaceLink
                      runId={run.id}
                      lane={lead}
                      pass={next.id}
                      onSelect={onSelect}
                    >
                      Lead’s next turn
                    </SessionWorkspaceLink>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
