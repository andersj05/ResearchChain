import { useEffect, useRef } from "react";
import { activityLabel } from "./research-session-workspace";
import type { SessionWorkspace } from "@/lib/swarm-workspaces";
import styles from "./research-session.module.css";

type Props = {
  lanes: SessionWorkspace[];
  selected: string;
  onSelect: (key: string) => void;
};

export function SessionRoster({ lanes, selected, onSelect }: Props) {
  const currentParent = lanes.find((lane) => lane.key === selected)?.parentKey;
  const selectedGroup = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (selectedGroup.current) selectedGroup.current.open = true;
  }, [selected, currentParent]);
  const swarm = lanes.some((lane) => lane.role === "director" || lane.parentKey);
  function select(lane: SessionWorkspace) {
    onSelect(lane.key);
    if (swarm && window.matchMedia("(max-width: 680px)").matches) {
      requestAnimationFrame(() =>
        document.getElementById("current-research-workspace")?.scrollIntoView(),
      );
    }
  }
  function workspace(lane: SessionWorkspace) {
    return (
      <button
        type="button"
        key={lane.key}
        aria-current={selected === lane.key ? "true" : undefined}
        onClick={() => select(lane)}
      >
        <strong>{lane.title}</strong>
        <span>
          {swarm && lane.role === "lead" && "Lead · "}
          {activityLabel(lane)}
          {lane.attempts.length > 1 && ` · Pass ${lane.attempts.length}`}
        </span>
      </button>
    );
  }
  return (
    <nav
      aria-label="Agent workspaces"
      className={swarm ? `${styles.roster} ${styles.swarmRoster}` : styles.roster}
    >
      <h2>Workspaces</h2>
      {lanes
        .filter((lane) => !lane.parentKey)
        .map((lane) => {
          if (!swarm || lane.role !== "lead") return workspace(lane);
          const children = lanes.filter((child) => child.parentKey === lane.key);
          return (
            <section key={lane.key} aria-label={`${lane.title} team`} className={styles.leadGroup}>
              {workspace(lane)}
              {!!children.length && (
                <details ref={lane.key === currentParent ? selectedGroup : undefined}>
                  <summary>
                    Researchers ({children.length}) ·{" "}
                    {children.filter((child) => child.state === "Active").length} active ·{" "}
                    {children.filter((child) => child.state === "Queued").length} queued
                  </summary>
                  {children.map(workspace)}
                </details>
              )}
            </section>
          );
        })}
    </nav>
  );
}
