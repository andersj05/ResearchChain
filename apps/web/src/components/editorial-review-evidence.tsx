import { useId, useRef, useState } from "react";
import type { SessionWorkspace } from "@/lib/swarm-workspaces";
import { SessionWorkspaceLink } from "./session-consultations";
import styles from "./editorial-review-evidence.module.css";

const pageSize = 8;

function reviewFindings(lanes: SessionWorkspace[], question: string) {
  const titles = new Map(lanes.map(({ key, title }) => [key, title]));
  const reviewText = `\n${question.trim()}\n`;
  return lanes
    .flatMap((lane) => {
      if (lane.role !== "researcher" && !lane.key.startsWith("agent-")) return [];
      // The team handoff uses one final researcher receipt per assignment.
      const final = lane.attempts.filter(({ status, result }) =>
        Boolean(
          status === "completed" &&
          result &&
          !result.next_lead &&
          !result.workspace_activity &&
          !result.team_plan &&
          !result.swarm_plan &&
          !result.swarm_action,
        ),
      );
      const pass = final[0];
      if (final.length !== 1 || !pass?.result) return [];
      const { conclusion, review_question: recorded } = pass.result;
      if (!conclusion?.trim() && !recorded?.trim() && !pass.result.workspace_files?.length)
        return [];
      return [
        {
          lane,
          pass,
          number: lane.attempts.indexOf(pass) + 1,
          lead: lane.parentKey ? titles.get(lane.parentKey) : undefined,
          raisedQuestion: Boolean(
            recorded?.trim() && reviewText.includes(`\n${recorded.trim()}\n`),
          ),
        },
      ];
    })
    .sort((left, right) => Number(right.raisedQuestion) - Number(left.raisedQuestion));
}

export function EditorialReviewEvidence({
  lanes,
  question,
  runId,
  onSelect,
}: {
  lanes: SessionWorkspace[];
  question: string;
  runId: string;
  onSelect: (workspace: string, pass: string | null) => void;
}) {
  const searchId = useId();
  const list = useRef<HTMLUListElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(pageSize);
  const findings = reviewFindings(lanes, question);
  if (!findings.length) return null;

  const terms = search.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  const matches = terms.length
    ? findings.filter(({ lane, lead, pass }) => {
        const text = [lane.title, lane.objective, lead, pass.result?.review_question]
          .join(" ")
          .toLowerCase();
        return terms.every((term) => text.includes(term));
      })
    : findings;
  const visible = matches.slice(0, limit);

  return (
    <details
      className={styles.evidence}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>Research behind this review ({findings.length})</summary>
      {expanded && (
        <div className={styles.findings}>
          {findings.length > pageSize && (
            <div className={styles.search}>
              <label htmlFor={searchId}>Find a research assignment</label>
              <input
                id={searchId}
                type="search"
                value={search}
                placeholder="Assignment or lead"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setLimit(pageSize);
                }}
              />
              <span role="status">
                {matches.length
                  ? `Showing ${visible.length} of ${matches.length} saved findings`
                  : "No matching findings."}
              </span>
            </div>
          )}
          {!!visible.length && (
            <ul aria-label="Saved research findings" ref={list}>
              {visible.map(({ lane, pass, number, lead, raisedQuestion }) => (
                <li key={pass.id}>
                  <SessionWorkspaceLink
                    runId={runId}
                    lane={lane}
                    pass={pass.id}
                    onSelect={onSelect}
                  >
                    {lane.title} · Pass {number}
                    {lead && ` · ${lead}`}
                  </SessionWorkspaceLink>
                  {raisedQuestion && <small>Raised this question</small>}
                </li>
              ))}
            </ul>
          )}
          {visible.length < matches.length && (
            <button
              type="button"
              className="text-link"
              onClick={() => {
                setLimit((current) => current + pageSize);
                requestAnimationFrame(() =>
                  list.current?.children[limit]?.querySelector("a")?.focus(),
                );
              }}
            >
              Show {Math.min(pageSize, matches.length - limit)} more findings
            </button>
          )}
        </div>
      )}
    </details>
  );
}
