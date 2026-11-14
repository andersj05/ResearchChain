"use client";

import { createParts } from "@ui-sdk/react/primitive";
import type { Workflow } from "@/lib/workflow";
import { workflowCanvas } from "./primitive";

const parts = createParts(workflowCanvas, {
  root: "div",
  world: "div",
  node: "button",
  reset: "button",
});

export function WorkflowCanvas({
  workflow,
  selected,
  onSelect,
  onMove,
}: {
  workflow: Workflow;
  selected: string;
  onSelect: (id: string) => void;
  onMove: (positions: Record<string, { x: number; y: number }>) => void;
}) {
  const positions = Object.fromEntries(workflow.nodes.map((node) => [node.id, node.position]));
  return (
    <parts.Root
      positions={positions}
      onPositionsChange={onMove}
      className="canvas"
      aria-label="Workflow canvas"
      aria-describedby="canvas-help"
    >
      <parts.World className="canvas-world">
        <svg className="connections" aria-hidden="true">
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          {workflow.edges.map((edge) => {
            const from = positions[edge.source];
            const to = positions[edge.target];
            if (!from || !to) return null;
            const x = from.x + 230;
            const y = from.y + 60;
            return (
              <path
                key={`${edge.source}-${edge.target}`}
                d={`M${x},${y} C${x + 55},${y} ${to.x - 55},${to.y + 60} ${to.x},${to.y + 60}`}
                markerEnd="url(#arrow)"
              />
            );
          })}
        </svg>
        {workflow.nodes.map((node, index) => (
          <parts.Node
            key={node.id}
            value={node.id}
            className={`graph-node ${selected === node.id ? "selected" : ""}`}
            aria-label={`Edit ${node.label}`}
            aria-pressed={selected === node.id}
            onClick={() => onSelect(node.id)}
          >
            <span className={`node-kind kind-${node.kind}`}>
              {node.kind === "note" ? "◇" : node.kind === "review" ? "◎" : "✓"} {node.kind}
            </span>
            <strong>{node.label}</strong>
            <span className="node-footer">
              <span>
                {String(index + 1).padStart(2, "0")} / {node.id}
              </span>
              <span>{workflow.start_node === node.id ? "START" : ""}</span>
            </span>
          </parts.Node>
        ))}
      </parts.World>
      <div className="canvas-toolbar">
        <parts.Reset className="button">Reset view</parts.Reset>
        <span>
          {workflow.nodes.length} nodes · {workflow.edges.length} connections
        </span>
      </div>
    </parts.Root>
  );
}
