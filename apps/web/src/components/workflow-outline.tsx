import { useState, type ReactElement } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { nodePresentation } from "@/components/node-kind";
import { referenceOf, scopeKey, type GraphCrumb } from "@/lib/workflow-editing";
import { workflowOutline, type OutlineStep } from "@/lib/workflow-outline";
import type { Graph, Workflow } from "@/lib/workflow";
import styles from "./workflow-outline.module.css";

export function WorkflowOutline({
  workflow,
  graph,
  path,
  selected,
  onSelect,
  onOpen,
}: {
  workflow: Workflow;
  graph: Graph;
  path: GraphCrumb[];
  selected: string;
  onSelect: (id: string) => void;
  onOpen: (id: string, path: GraphCrumb[], field?: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  function renderStep(
    { node, branches, issue }: OutlineStep,
    location: GraphCrumb[],
    entry: string,
  ): ReactElement {
    const label = node.label || node.id;
    const ref = referenceOf(node);
    const loop = node.config?.type === "loop" ? node.config : undefined;
    const matches =
      ref && workflow.subgraphs?.filter((definition) => scopeKey(definition) === scopeKey(ref));
    const body =
      ref &&
      matches?.length === 1 &&
      location.length < 8 &&
      !location.some((crumb) => scopeKey(crumb.ref) === scopeKey(ref))
        ? matches[0]
        : undefined;
    const key = JSON.stringify([location, node.id]);
    const nestedLabel = branches ? "branches" : loop ? "loop body" : "subgraph body";
    const open = expanded[key] ?? !!branches;
    const Icon = open ? ChevronDown : ChevronRight;
    const inCurrentGraph = location === path;
    return (
      <li key={key}>
        <div className={styles.row}>
          {(branches || body) && (
            <button
              type="button"
              className={styles.toggle}
              aria-label={`${open ? "Hide" : "Show"} ${nestedLabel} for ${label}`}
              aria-expanded={open}
              onClick={() => setExpanded((previous) => ({ ...previous, [key]: !open }))}
            >
              <Icon size={14} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="outline-row"
            aria-pressed={inCurrentGraph && selected === node.id}
            onClick={() => (inCurrentGraph ? onSelect(node.id) : onOpen(node.id, location))}
          >
            <span className="outline-label">{label}</span>
            <span className={`outline-kind kind-${node.kind}`}>
              {nodePresentation(node).shortLabel}
            </span>
            {entry === node.id && <small>Start</small>}
          </button>
        </div>
        {(issue || (ref && !body)) && (
          <p className={styles.issue}>{issue ?? "Pinned body unavailable"}</p>
        )}
        {open && branches && (
          <div className={styles.children}>
            {branches.map(({ name, steps }) => (
              <div key={name}>
                <div className={styles.caption}>{name}</div>
                <ol className={styles.steps} aria-label={`${name} branch`}>
                  {steps.map((step) => renderStep(step, location, entry))}
                </ol>
              </div>
            ))}
          </div>
        )}
        {open && ref && body && (
          <div className={styles.children} role="group" aria-label={`${nestedLabel} for ${label}`}>
            <div className={styles.caption}>
              {body.name || ref.id} · v{ref.version}
            </div>
            {loop && (
              <div className={styles.loop}>
                <span>
                  {loop.until && "Up to "}
                  {loop.max_iterations} {loop.max_iterations === 1 ? "iteration" : "iterations"}
                </span>
                {loop.until && (
                  <button
                    type="button"
                    aria-label={`Stop condition for ${label}`}
                    onClick={() => onOpen(node.id, location, "until")}
                  >
                    Stop condition
                  </button>
                )}
              </div>
            )}
            <ol className={styles.steps} aria-label={`Steps in ${body.name || ref.id}`}>
              {renderGraph(body, [...location, { ref, via: node.id }])}
            </ol>
          </div>
        )}
      </li>
    );
  }

  function renderGraph(current: Graph, location: GraphCrumb[]): ReactElement {
    const { connected, other } = workflowOutline(current);
    return (
      <>
        {connected.map((step) => renderStep(step, location, current.start_node))}
        {other.length > 0 && (
          <li role="presentation" className={styles.other}>
            <div className={styles.caption}>Steps outside the connected outline</div>
            <ul className={styles.steps} aria-label="Steps outside the connected outline">
              {other.map((step) => renderStep(step, location, current.start_node))}
            </ul>
          </li>
        )}
      </>
    );
  }

  return (
    <>
      <div className="outline-heading">
        <h3>{path.length ? "Subgraph outline" : "Workflow outline"}</h3>
      </div>
      <ol
        className="node-outline"
        aria-label={path.length ? "Subgraph outline" : "Workflow outline"}
      >
        {renderGraph(graph, path)}
      </ol>
    </>
  );
}
