import { useState } from "react";
import type { SessionWorkspace } from "@/lib/swarm-workspaces";
import type { RunSnapshot } from "@/lib/workflow";
import { activityLabel } from "./research-session-workspace";
import { SessionWorkspaceLink } from "./session-consultations";
import styles from "./study-team-graph.module.css";

type Review = NonNullable<RunSnapshot["review"]>;
type GraphContext = {
  runId: string;
  selected: string;
  onSelect: (workspace: string, pass: string | null) => void;
};

const stateTone: Partial<Record<NonNullable<SessionWorkspace["state"]>, string>> = {
  Active: "active",
  Completed: "done",
  Failed: "failed",
  Interrupted: "failed",
  Limited: "failed",
  "Awaiting judgment": "review",
  "Consultation requested": "review",
};

function LaneNode({ lane, context }: { lane: SessionWorkspace; context: GraphContext }) {
  return (
    <SessionWorkspaceLink
      className={styles.node}
      runId={context.runId}
      lane={lane}
      current={context.selected === lane.key}
      onSelect={context.onSelect}
    >
      <strong>{lane.title}</strong>
      <span className={styles.state} data-tone={lane.state && stateTone[lane.state]}>
        {activityLabel(lane)}
      </span>
    </SessionWorkspaceLink>
  );
}

function LeadTeam({
  lead,
  researchers,
  review,
  context,
}: {
  lead: SessionWorkspace;
  researchers: SessionWorkspace[];
  review?: Review;
  context: GraphContext;
}) {
  const [expanded, setExpanded] = useState(false);
  const active = researchers.filter(({ state }) => state === "Active").length;
  const complete = researchers.filter(({ state }) => state === "Completed").length;
  const queued = researchers.filter(({ state }) => state === "Queued").length;
  const needsAttention = researchers.filter(
    ({ state }) => state && stateTone[state] === "failed",
  ).length;
  const stopped = researchers.length - active - complete - queued - needsAttention;
  return (
    <li className={styles.team} aria-label={`${lead.title} lead team`}>
      <LaneNode lane={lead} context={context} />
      {review && (
        <a className={styles.consultation} href={`#consultation-${review.interrupt_id}`}>
          Answer {lead.title}
        </a>
      )}
      {researchers.length > 0 && (
        <details className={styles.researchers} onToggle={(e) => setExpanded(e.currentTarget.open)}>
          <summary>
            <strong>Researchers ({researchers.length})</strong>
            <span>
              {[
                active > 0 && `${active} active`,
                queued > 0 && `${queued} queued`,
                complete > 0 && `${complete} complete`,
                needsAttention > 0 && `${needsAttention} need attention`,
                stopped > 0 && `${stopped} stopped`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </summary>
          {expanded && (
            <ul aria-label={`Researchers for ${lead.title}`}>
              {researchers.map((lane) => (
                <li key={lane.key}>
                  <LaneNode lane={lane} context={context} />
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </li>
  );
}

function EditorialNode({ run, pending }: { run: RunSnapshot; pending: boolean }) {
  const review = run.events.find((event) => event.path === "root/judgment");
  const decision = review?.review_response?.decision;
  if (!pending && !review && !run.workflow.nodes?.some(({ id }) => id === "judgment")) return null;
  const stopped = ["completed", "failed", "limited", "cancelled", "rejected"].includes(run.status);
  const state = pending
    ? "Awaiting your judgment"
    : decision === "approve"
      ? "Approved for writing"
      : decision === "reject"
        ? "Ended at review"
        : review
          ? "Review skipped"
          : stopped
            ? "Not reached"
            : "Awaiting findings";
  const label = (
    <>
      <strong>Editorial judgment</strong>
      <span className={styles.state} data-tone={pending ? "review" : decision && "done"}>
        {state}
      </span>
    </>
  );
  return pending ? (
    <a className={styles.node} href="#editorial-review">
      {label}
    </a>
  ) : (
    <div className={styles.node}>{label}</div>
  );
}

export function StudyTeamGraph({
  run,
  lanes,
  consultations,
  editorialReview,
  selected,
  onSelect,
}: {
  run: RunSnapshot;
  lanes: SessionWorkspace[];
  consultations: Review[];
  editorialReview: boolean;
} & Pick<GraphContext, "selected" | "onSelect">) {
  const director = lanes.find(({ role }) => role === "director");
  const editor = lanes.find(({ role }) => role === "editor");
  if (!director || !editor) return null;

  const leads = lanes.filter(({ role }) => role === "lead");
  const researchers = new Map<string, SessionWorkspace[]>();
  for (const lane of lanes) {
    if (!lane.parentKey) continue;
    const group = researchers.get(lane.parentKey) ?? [];
    group.push(lane);
    researchers.set(lane.parentKey, group);
  }
  const reviews = new Map(consultations.map((review) => [review.perspective?.action_path, review]));
  const context = { runId: run.id, selected, onSelect };

  return (
    <section
      id="study-team-graph"
      className={styles.panel}
      aria-labelledby="study-team-graph-title"
    >
      <h2 id="study-team-graph-title">Team graph</h2>
      <ol className={styles.stages} aria-label="Research handoffs">
        <li className={styles.stage}>
          <h3>Planning</h3>
          <LaneNode lane={director} context={context} />
        </li>
        <li className={styles.stage}>
          <h3>
            Lead teams <span>{leads.length}</span>
          </h3>
          {leads.length ? (
            <ul className={styles.teams}>
              {leads.map((lead) => (
                <LeadTeam
                  key={lead.key}
                  lead={lead}
                  researchers={researchers.get(lead.key) ?? []}
                  review={reviews.get(lead.attempts.at(-1)?.path)}
                  context={context}
                />
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>No lead assignments recorded.</p>
          )}
        </li>
        <li className={styles.stage}>
          <h3>Report handoff</h3>
          <div className={styles.editorial}>
            <EditorialNode run={run} pending={editorialReview} />
            <LaneNode lane={editor} context={context} />
          </div>
        </li>
      </ol>
    </section>
  );
}
