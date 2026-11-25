import { useEffect, useId, useRef, useState } from "react";
import { activityLabel, focusSessionWorkspace } from "./research-session-workspace";
import type { SessionWorkspace } from "@/lib/swarm-workspaces";
import styles from "./research-session.module.css";

type Props = {
  lanes: SessionWorkspace[];
  selected: string;
  onSelect: (key: string) => void;
};

const matchPageSize = 12;

export function SessionRoster({ lanes, selected, onSelect }: Props) {
  const searchId = useId();
  const statusId = useId();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [limit, setLimit] = useState(matchPageSize);
  const byKey = new Map(lanes.map((lane) => [lane.key, lane]));
  const current = byKey.get(selected);
  const currentParent = current?.parentKey;
  const selectedGroup = useRef<HTMLDetailsElement>(null);
  const searchResults = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (selectedGroup.current) selectedGroup.current.open = true;
  }, [selected, currentParent]);
  const swarm = lanes.some((lane) => lane.role === "director" || lane.parentKey);
  const canSearch = swarm && lanes.some((lane) => lane.role === "researcher");
  const statuses = new Set<string>();
  for (const lane of lanes) if (lane.state) statuses.add(lane.state);
  if (status) statuses.add(status);
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtering = canSearch && (!!status || terms.length > 0);
  function parentTitle(lane: SessionWorkspace) {
    return lane.parentKey ? byKey.get(lane.parentKey)?.title : undefined;
  }
  const matches = filtering
    ? lanes.filter((lane) => {
        if (status && lane.state !== status) return false;
        if (!terms.length) return true;
        const text = [lane.title, parentTitle(lane), lane.objective, lane.path]
          .join(" ")
          .toLowerCase();
        return terms.every((term) => text.includes(term));
      })
    : [];
  const visibleMatches = matches.slice(0, limit);
  function updateSearch(value: string) {
    setSearch(value);
    setLimit(matchPageSize);
  }
  function select(lane: SessionWorkspace, focusReader = false) {
    onSelect(lane.key);
    if (focusReader || window.matchMedia("(max-width: 680px)").matches) focusSessionWorkspace();
  }
  function workspace(lane: SessionWorkspace, preview = false, onOpen = () => select(lane)) {
    const team = preview ? parentTitle(lane) : undefined;
    return (
      <button
        type="button"
        key={lane.key}
        aria-current={selected === lane.key ? "true" : undefined}
        onClick={onOpen}
      >
        <strong>{lane.title}</strong>
        <span>
          {team && `${team} · `}
          {swarm && lane.role === "lead" && "Lead · "}
          {activityLabel(lane)}
          {lane.attempts.length > 1 && ` · Pass ${lane.attempts.length}`}
        </span>
        {preview && <span className={styles.rosterObjective}>{lane.objective}</span>}
      </button>
    );
  }
  return (
    <nav
      aria-label="Agent workspaces"
      className={swarm ? `${styles.roster} ${styles.swarmRoster}` : styles.roster}
    >
      <h2>Workspaces</h2>
      {canSearch && (
        <div className={styles.rosterSearch}>
          <label htmlFor={searchId}>Find a workspace</label>
          <input
            id={searchId}
            type="search"
            placeholder="Name or assignment"
            value={search}
            onChange={(event) => updateSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape" && search) {
                event.preventDefault();
                updateSearch("");
              }
              if (event.key === "Enter" && matches[0]) {
                event.preventDefault();
                select(matches[0], true);
              }
            }}
          />
          <label htmlFor={statusId}>Workspace status</label>
          <select
            id={statusId}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setLimit(matchPageSize);
            }}
          >
            <option value="">Any status</option>
            {[...statuses].sort().map((state) => (
              <option key={state}>{state}</option>
            ))}
          </select>
        </div>
      )}
      {filtering && (
        <>
          {current && !visibleMatches.includes(current) && (
            <div className={styles.rosterSelection}>
              <p>Open workspace</p>
              {workspace(current, true, focusSessionWorkspace)}
            </div>
          )}
          <p className={styles.rosterMatchCount} role="status">
            {!matches.length
              ? "No matching workspaces."
              : matches.length > limit
                ? `Showing ${visibleMatches.length} of ${matches.length} matching workspaces`
                : `${matches.length} matching ${matches.length === 1 ? "workspace" : "workspaces"}`}
          </p>
          {!!matches.length && (
            <ul
              className={styles.rosterMatches}
              aria-label="Matching workspaces"
              ref={searchResults}
            >
              {visibleMatches.map((lane) => (
                <li key={lane.key}>{workspace(lane, true)}</li>
              ))}
            </ul>
          )}
          {matches.length > limit && (
            <button
              type="button"
              className={styles.moreRosterMatches}
              onClick={() => {
                setLimit((count) => count + matchPageSize);
                requestAnimationFrame(() =>
                  searchResults.current?.children[limit]?.querySelector("button")?.focus(),
                );
              }}
            >
              Show {Math.min(matchPageSize, matches.length - limit)} more workspaces
            </button>
          )}
        </>
      )}
      <div className={styles.rosterGroups} hidden={filtering}>
        {lanes
          .filter((lane) => !lane.parentKey)
          .map((lane) => {
            if (!swarm || lane.role !== "lead") return workspace(lane);
            const children = lanes.filter((child) => child.parentKey === lane.key);
            return (
              <section
                key={lane.key}
                aria-label={`${lane.title} team`}
                className={styles.leadGroup}
              >
                {workspace(lane)}
                {!!children.length && (
                  <details ref={lane.key === currentParent ? selectedGroup : undefined}>
                    <summary>
                      Researchers ({children.length}) ·{" "}
                      {children.filter((child) => child.state === "Active").length} active ·{" "}
                      {children.filter((child) => child.state === "Queued").length} queued
                    </summary>
                    {children.map((child) => workspace(child))}
                  </details>
                )}
              </section>
            );
          })}
      </div>
    </nav>
  );
}
