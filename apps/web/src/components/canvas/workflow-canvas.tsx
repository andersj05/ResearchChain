"use client";

import { createParts } from "@ui-sdk/react/primitive";
import type { Workflow } from "@/lib/workflow";
import { workflowCanvas } from "./primitive";
import { Maximize, Minus, Plus, RotateCcw } from "lucide-react";
import { NodeKindIcon, nodeKinds } from "@/components/node-kind";

const parts = createParts(workflowCanvas, {
  root: "div",
  world: "div",
  node: "button",
  reset: "button",
  fit: "button",
  zoomIn: "button",
  zoomOut: "button",
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
        {workflow.nodes.map((node) => (
          <parts.Node
            key={node.id}
            value={node.id}
            id={`workflow-node-${node.id}`}
            className={`graph-node ${selected === node.id ? "selected" : ""}`}
            aria-label={`Edit ${node.label}`}
            aria-pressed={selected === node.id}
            onClick={() => onSelect(node.id)}
          >
            <span className="node-topline">
              <NodeKindIcon kind={node.kind} />
              <span className="node-kind">{nodeKinds[node.kind].label}</span>
              {workflow.start_node === node.id && <span className="start-label">Start</span>}
            </span>
            <strong>{node.label}</strong>
            <span className="node-summary">
              {node.instructions ||
                (node.kind === "finish" ? "End of workflow" : "Add instructions…")}
            </span>
            <span className="node-port port-in" aria-hidden="true" />
            <span className="node-port port-out" aria-hidden="true" />
          </parts.Node>
        ))}
      </parts.World>
      <div className="canvas-toolbar">
        <parts.ZoomOut className="button icon-button" aria-label="Zoom out">
          <Minus size={16} aria-hidden="true" />
        </parts.ZoomOut>
        <parts.ZoomIn className="button icon-button" aria-label="Zoom in">
          <Plus size={16} aria-hidden="true" />
        </parts.ZoomIn>
        <parts.Fit className="button" aria-label="Fit workflow to view">
          <Maximize size={15} aria-hidden="true" />
          Fit view
        </parts.Fit>
        <parts.Reset className="button icon-button" aria-label="Reset view">
          <RotateCcw size={15} aria-hidden="true" />
        </parts.Reset>
      </div>
    </parts.Root>
  );
}
