import { useId, useMemo, useState } from "react";
import type { components } from "@researchchain/contracts";
import { modelAttemptStatus } from "@/lib/run-inspection";
import type { SessionWorkspace } from "@/lib/swarm-workspaces";
import { focusSessionWorkspace } from "./research-session-workspace";
import { formatTime } from "./run-status";
import { useStudyIndex, type StudyIndexFocus } from "./study-index-link";
import styles from "./research-session.module.css";

type Attempt = components["schemas"]["ModelAttempt"];
type ActivityCursor = { id: string; timestamp: number };
const pageSize = 12;

function activityRowId(id: string) {
  return `study-activity-${id}`;
}

function newestFirst(left: ActivityCursor, right: ActivityCursor) {
  return right.timestamp - left.timestamp || left.id.localeCompare(right.id);
}

function resultText(attempt: Attempt) {
  const result = attempt.result;
  const action = result?.swarm_action;
  const leadText =
    action?.action === "ask_expert"
      ? action.consultation.question
      : action?.action === "delegate"
        ? action.rationale
        : action?.findings;
  const assignments =
    action?.action === "delegate"
      ? action.assignments
      : (result?.swarm_plan?.leads ?? result?.team_plan?.assignments);
  return [
    result?.workspace_activity?.summary,
    leadText,
    result?.discovery?.observation,
    result?.next_lead,
    result?.conclusion,
    result?.revision_summary,
    result?.discovery?.question,
    action?.action === "ask_expert" ? action.consultation.thesis : undefined,
    ...(assignments ?? []).map(({ title, objective }) => `${title} · ${objective}`),
    attempt.reason,
    modelAttemptStatus(attempt),
  ].filter((text): text is string => Boolean(text?.trim()));
}

function activityEntries(lanes: SessionWorkspace[]) {
  const titles = new Map(lanes.map(({ key, title }) => [key, title]));
  return lanes
    .flatMap((lane) =>
      lane.attempts.map((attempt, index) => {
        const time = attempt.finished_at ?? attempt.created_at;
        const result = attempt.result;
        return {
          id: attempt.id,
          lane,
          lead: lane.parentKey ? titles.get(lane.parentKey) : undefined,
          path: attempt.path,
          pass: index + 1,
          time,
          timestamp: Date.parse(time),
          descriptions: resultText(attempt),
          files: [
            ...new Set(
              [
                ...(result?.workspace_activity?.files ?? []),
                ...(result?.workspace_files ?? []),
              ].map((file) => file.name),
            ),
          ],
        };
      }),
    )
    .sort(newestFirst);
}

function excerpt(text: string, terms: string[]) {
  const line = text.replace(/\s+/gu, " ").trim();
  const normalized = line.toLowerCase();
  const position = terms.reduce((first, term) => {
    const index = normalized.indexOf(term);
    return index < 0 ? first : Math.min(first, index);
  }, line.length);
  const start = position === line.length ? 0 : Math.max(0, position - 32);
  const end = start + 180;
  return `${start ? "…" : ""}${line.slice(start, end).trimEnd()}${end < line.length ? "…" : ""}`;
}

export function SessionActivity({
  lanes,
  select,
  returnRef,
}: {
  lanes: SessionWorkspace[];
  select: (key: string, id: string, targetId: string) => void;
  returnRef: StudyIndexFocus;
}) {
  const [open, setOpen] = useStudyIndex("activity", returnRef);
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [shownThrough, setShownThrough] = useState<ActivityCursor>();
  const count = lanes.reduce((total, lane) => total + lane.attempts.length, 0);
  const entries = useMemo(() => (open ? activityEntries(lanes) : []), [lanes, open]);
  const normalized = query.trim().toLowerCase();
  const passQuery = /\bpass\s+#?(\d+)\b/u.exec(normalized);
  const pass = passQuery && Number(passQuery[1]);
  const terms = normalized
    .replace(passQuery?.[0] ?? "", "")
    .split(/\s+/u)
    .filter(Boolean);
  const hasTerms = terms.length > 0;
  const searchText = useMemo(
    () =>
      hasTerms
        ? entries.map((entry) =>
            [
              entry.lane.title,
              entry.lane.objective,
              entry.lane.key,
              entry.lead,
              entry.path,
              ...entry.descriptions,
              ...entry.files,
            ]
              .join("\n")
              .toLowerCase(),
          )
        : [],
    [entries, hasTerms],
  );
  const matching = normalized
    ? entries.filter(
        (entry, index) =>
          (pass === null || entry.pass === pass) &&
          terms.every((term) => searchText[index]?.includes(term)),
      )
    : entries;
  // Preserve the oldest revealed receipt when a poll adds newer rows above it.
  const throughIndex = shownThrough
    ? matching.findLastIndex((entry) => newestFirst(entry, shownThrough) <= 0)
    : -1;
  const visible = matching.slice(0, Math.max(pageSize, throughIndex + 1));
  const hasMore = visible.length < matching.length;

  function find(value: string) {
    setQuery(value);
    setShownThrough(undefined);
  }
  function openPass(entry: (typeof entries)[number]) {
    select(entry.lane.key, entry.id, activityRowId(entry.id));
    focusSessionWorkspace();
  }
  function showEarlier() {
    const firstNew = matching[visible.length];
    if (!firstNew) return;
    const lastNew = matching[Math.min(visible.length + pageSize, matching.length) - 1]!;
    setShownThrough({ id: lastNew.id, timestamp: lastNew.timestamp });
    requestAnimationFrame(() => {
      document.getElementById(activityRowId(firstNew.id))?.focus();
    });
  }

  if (!count) return null;
  return (
    <details
      id="research-activity"
      className={styles.activity}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary id="research-activity-heading">
        Activity log · {count} recorded {count === 1 ? "pass" : "passes"}
      </summary>
      {open && (
        <>
          <div className={styles.activitySearch}>
            <label htmlFor={searchId}>Search study activity</label>
            <input
              id={searchId}
              type="search"
              placeholder="Workspace, pass, finding, or file"
              value={query}
              onChange={(event) => find(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  find("");
                }
                if (event.key === "Enter" && normalized && matching.length === 1) {
                  event.preventDefault();
                  openPass(matching[0]!);
                }
              }}
            />
          </div>
          {normalized && (
            <p className={styles.activityCount} role="status">
              {!matching.length
                ? "No passes match this search."
                : hasMore
                  ? `Showing ${visible.length} of ${matching.length} matching passes`
                  : `${matching.length} matching ${matching.length === 1 ? "pass" : "passes"}`}
            </p>
          )}
          {!!visible.length && (
            <ol aria-label="Recorded model passes">
              {visible.map((entry) => {
                const includesTerm = (value: string) =>
                  terms.some((term) => value.toLowerCase().includes(term));
                const preview = entry.descriptions.find(includesTerm) ?? entry.descriptions[0];
                const namedFiles = entry.files.filter(includesTerm).slice(0, 3);
                return (
                  <li key={entry.id}>
                    <button
                      id={activityRowId(entry.id)}
                      type="button"
                      onClick={() => openPass(entry)}
                    >
                      <time dateTime={entry.time}>{formatTime(entry.time, true)}</time>
                      <span>
                        <strong>{entry.lane.title}</strong> · Pass {entry.pass}
                        {entry.lead && <small>{entry.lead}</small>}
                        {preview && <small>{excerpt(preview, terms)}</small>}
                        {!!namedFiles.length && <small>{namedFiles.join(", ")}</small>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {hasMore && (
            <button className="text-link" type="button" onClick={showEarlier}>
              Show earlier passes
            </button>
          )}
        </>
      )}
    </details>
  );
}
