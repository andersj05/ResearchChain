import { useEffect, useRef, useState } from "react";
import { api, ApiError, type RunSnapshot } from "@/lib/workflow";
import { ownerStoragePrefix } from "@/lib/access";
import { useOwner } from "./access-context";
import type { SessionWorkspace } from "./research-session-workspace";
import { formatTime } from "./run-status";
import styles from "./research-session.module.css";

type Direction = NonNullable<RunSnapshot["owner_directions"]>[number];
type Draft = { id: string; text: string; pending: boolean };
const blank: Draft = { id: "", text: "", pending: false };

function loadDraft(key: string): Draft {
  try {
    const draft = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (
      draft &&
      typeof draft.text === "string" &&
      draft.text.length <= 3000 &&
      typeof draft.pending === "boolean" &&
      typeof draft.id === "string"
    )
      return draft;
  } catch {
    /* Keep the composer usable when storage is unavailable. */
  }
  return blank;
}

export function SessionDirections({
  run,
  lanes,
  onRecorded,
  onSelect,
}: {
  run: RunSnapshot;
  lanes: SessionWorkspace[];
  onRecorded: (note: Direction) => void;
  onSelect: (workspace: string, pass: string) => void;
}) {
  const { owner, active } = useOwner();
  const key = ownerStoragePrefix(owner) + ".team-direction." + run.id;
  const [storedDraft, setDraft] = useState(() => loadDraft(key));
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const notes = run.owner_directions ?? [];
  const confirmed = storedDraft.pending && notes.some((note) => note.id === storedDraft.id);
  const draft = confirmed ? blank : storedDraft;
  const feedback = confirmed ? "Saved for upcoming passes." : message;
  const open = ["queued", "running", "paused", "interrupted"].includes(run.status);
  const accepting = open && !lanes.find((lane) => lane.key === "editor")?.attempts.length;
  function remember(next: Draft) {
    setDraft(next);
    try {
      if (next.text) sessionStorage.setItem(key, JSON.stringify(next));
      else sessionStorage.removeItem(key);
    } catch {
      /* The pending identity still lives in this component. */
    }
  }
  useEffect(() => {
    if (confirmed) {
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* The server receipt still confirms delivery. */
      }
    }
  }, [confirmed, key]);
  async function send() {
    if (!active || sending.current || !draft.text.trim()) return;
    const request = { id: draft.id || crypto.randomUUID(), text: draft.text.trim() };
    sending.current = true;
    setBusy(true);
    setError("");
    remember({ ...request, pending: true });
    try {
      const receipt = await api<Direction>(`research-sessions/${run.id}/directions`, request);
      remember(blank);
      setMessage("Saved for upcoming passes.");
      onRecorded(receipt);
    } catch (cause) {
      if (cause instanceof ApiError && [400, 404, 409, 422].includes(cause.status ?? 0))
        remember({ ...request, pending: false });
      setError(cause instanceof Error ? cause.message : "The direction could not be confirmed.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  if (
    run.research_manifest?.tool_config.owner_directions_version !== "owner-directions-1" ||
    (!accepting && !notes.length && !draft.pending && !error)
  )
    return null;
  return (
    <details className={styles.guidance}>
      <summary>
        {accepting ? "Guide the team" : "Team directions"}
        {notes.length > 0 && ` (${notes.length})`}
      </summary>
      <div className={styles.guidanceBody}>
        {!!notes.length && (
          <ol>
            {notes.map((note) => {
              const reached = lanes.flatMap((lane) =>
                lane.attempts.flatMap((attempt, index) =>
                  attempt.owner_direction_ids?.includes(note.id)
                    ? [{ key: lane.key, title: lane.title, id: attempt.id, number: index + 1 }]
                    : [],
                ),
              );
              return (
                <li key={note.id}>
                  <time dateTime={note.created_at}>{formatTime(note.created_at)}</time>
                  <p>{note.text}</p>
                  {reached.length ? (
                    <details>
                      <summary>
                        Included in {reached.length} saved{" "}
                        {reached.length === 1 ? "request" : "requests"}
                      </summary>
                      <div className={styles.receiptLinks}>
                        {reached.map((item) => (
                          <button
                            className="text-link"
                            key={item.id}
                            onClick={() => onSelect(item.key, item.id)}
                          >
                            {item.title} · Pass {item.number}
                          </button>
                        ))}
                      </div>
                    </details>
                  ) : (
                    <span>
                      {open
                        ? "Awaiting a model request"
                        : "No saved request included this direction."}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {(accepting || draft.pending) && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label htmlFor="team-direction">Direction for upcoming passes</label>
            <p>Researchers and the editor receive your note when preparing their next request.</p>
            <textarea
              id="team-direction"
              value={draft.text}
              rows={3}
              maxLength={3000}
              disabled={busy || !active || draft.pending}
              onChange={(event) => {
                setMessage("");
                setError("");
                remember({ id: "", text: event.target.value, pending: false });
              }}
            />
            <button
              type="submit"
              className="button"
              disabled={!active || busy || !draft.text.trim()}
            >
              {draft.pending && !busy ? "Retry direction" : "Send direction"}
            </button>
          </form>
        )}
        {feedback && <p role="status">{feedback}</p>}
        {error && !confirmed && <p role="alert">{error}</p>}
      </div>
    </details>
  );
}
