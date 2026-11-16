"use client";

import { memo, useCallback, useState } from "react";
import { createParts } from "@ui-sdk/react/primitive";
import type { Graph, SubgraphDefinition, WorkflowNode } from "@/lib/workflow";
import { connectionsFor, portsFor, referenceOf, type Port } from "@/lib/workflow-editing";
import { workflowCanvas, type CanvasPort } from "./primitive";
import { Maximize, Minus, Plus, RotateCcw } from "lucide-react";
import { nodePresentation } from "@/components/node-kind";

const parts = createParts(workflowCanvas, {
  root: "div",
  world: "div",
  group: "div",
  node: "button",
  open: "button",
  port: "button",
  edge: "path",
  draft: "path",
  reset: "button",
  fit: "button",
  zoomIn: "button",
  zoomOut: "button",
});

export function WorkflowCanvas({
  workflow,
  definitions = [],
  selected,
  onSelect,
  onMove,
  onConnect,
  onOpen,
}: {
  workflow: Graph;
  definitions?: SubgraphDefinition[];
  selected: string;
  onSelect: (id: string) => void;
  onMove: (
    positions: Record<string, { x: number; y: number }>,
    details: { reason: string },
  ) => void;
  onConnect?: (from: Port, to: Port) => void;
  onOpen?: (node: WorkflowNode, child?: string) => void;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const toggle = useCallback(
    (id: string) =>
      setExpanded((previous) =>
        previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
      ),
    [],
  );
  const positions = Object.fromEntries(workflow.nodes.map((node) => [node.id, node.position]));
  const connections = connectionsFor(workflow);
  const nodes = workflow.nodes.map((node) => {
    const ports = portsFor(node);
    const ref = referenceOf(node);
    const body = ref
      ? definitions.find((item) => item.id === ref.id && item.version === ref.version)
      : undefined;
    const rows = Math.max(
      ...["input", "output"].map(
        (direction) => ports.filter((port) => port.direction === direction).length,
      ),
    );
    return { node, ports, body, baseHeight: 98 + rows * 28, open: expanded.includes(node.id) };
  });
  const ports: Record<string, CanvasPort> = Object.fromEntries(
    nodes.flatMap(({ node, ports }) =>
      ports.map((port) => [
        port.key,
        {
          ...port,
          label: `${node.label}: ${port.direction} ${port.type} ${port.name}`,
          offset: {
            x: port.direction === "input" ? 0 : 230,
            y: 112 + ports.filter((item) => item.direction === port.direction).indexOf(port) * 28,
          },
        },
      ]),
    ),
  );
  const sizes = Object.fromEntries(
    nodes.map(({ node, baseHeight, body, open }) => [
      node.id,
      { width: 230, height: baseHeight + (body ? 36 : 0) + (open && body ? 160 : 0) },
    ]),
  );
  return (
    <parts.Root
      positions={positions}
      sizes={sizes}
      ports={ports}
      onPositionsChange={onMove}
      onSelect={onSelect}
      onOpen={(id, child) => {
        const node = workflow.nodes.find((item) => item.id === id);
        if (node) onOpen?.(node, child);
      }}
      onConnect={(from, to) => {
        if (ports[from] && ports[to]) onConnect?.(ports[from], ports[to]);
      }}
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
          {connections.map((connection) => (
            <CanvasEdge
              key={`${connection.from}/${connection.to}`}
              value={`${connection.from}/${connection.to}`}
              type={connection.type}
            />
          ))}
          <parts.Draft className="connection-draft" />
        </svg>
        {nodes.map(({ node, ports: nodePorts, body, baseHeight, open }) => {
          const descriptions = Object.fromEntries(
            nodePorts.map((port) => [
              port.key,
              connections
                .filter((edge) => edge.from === port.key || edge.to === port.key)
                .map(
                  (edge) =>
                    `Connected to ${ports[edge.from === port.key ? edge.to : edge.from]?.label ?? "missing port"}.`,
                )
                .join(" ") ||
                "Unconnected. Enter starts a connection; arrows choose a port; Enter connects.",
            ]),
          );
          return (
            <CanvasNode
              key={node.id}
              node={node}
              ports={nodePorts.map((port) => ports[port.key]!)}
              body={body}
              baseHeight={baseHeight}
              height={sizes[node.id]!.height}
              open={open}
              selected={selected === node.id}
              start={workflow.start_node === node.id}
              descriptions={descriptions}
              descriptionKey={JSON.stringify(descriptions)}
              onToggle={toggle}
            />
          );
        })}
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

const CanvasEdge = memo(function CanvasEdge({
  value,
  type,
}: {
  value: string;
  type: Port["type"];
}) {
  return <parts.Edge value={value} className={`connection-${type}`} markerEnd="url(#arrow)" />;
});

type CanvasNodeProps = {
  node: WorkflowNode;
  ports: CanvasPort[];
  body?: SubgraphDefinition;
  baseHeight: number;
  height: number;
  open: boolean;
  selected: boolean;
  start: boolean;
  descriptions: Record<string, string>;
  descriptionKey: string;
  onToggle: (id: string) => void;
};
// Moving one node changes positions in the primitive, while the document's labels,
// ports and groups stay mounted. Do not capture editor callbacks in memoized cards.
const CanvasNode = memo(
  function CanvasNode({
    node,
    ports,
    body,
    baseHeight,
    height,
    open,
    selected,
    start,
    descriptions,
    onToggle,
  }: CanvasNodeProps) {
    return (
      <parts.Group
        value={node.id}
        className={`graph-group ${selected ? "selected" : ""}`}
        style={{ height }}
        data-node-id={node.id}
      >
        <parts.Node
          value={node.id}
          id={`workflow-node-${node.id}`}
          className={`graph-node ${selected ? "selected" : ""}`}
          aria-label={`Edit ${node.label}`}
          aria-pressed={selected}
        >
          <span className="node-topline">
            <span className={`node-kind kind-${node.kind}`}>{nodePresentation(node).label}</span>
            {start && <span className="start-label">Start</span>}
          </span>
          <strong>{node.label}</strong>
          <span className="node-summary">
            {node.instructions ||
              (node.kind === "finish" ? "End of workflow" : "Add instructions…")}
          </span>
        </parts.Node>
        {ports.map((port) => (
          <parts.Port
            key={port.key}
            value={port.key}
            className={`graph-port port-${port.direction} port-${port.type}`}
            style={{ top: port.offset.y - 14 }}
            aria-label={port.label}
            aria-description={descriptions[port.key]}
          >
            <span aria-hidden="true" className="port-dot" />
            <span className="port-caption">
              <span>{port.name}</span>
              <small>{port.type}</small>
            </span>
          </parts.Port>
        ))}
        {body && (
          <div className="subgraph-group" style={{ top: baseHeight }}>
            <div className="group-actions">
              <parts.Open value={node.id} node={node.id}>
                Open subgraph
              </parts.Open>
              <button
                type="button"
                aria-label={`${open ? "Collapse" : "Expand"} ${node.label}`}
                aria-expanded={open}
                onClick={() => onToggle(node.id)}
              >
                {open ? "Collapse" : "Expand"}
              </button>
            </div>
            {open && (
              <div className="subgraph-preview" aria-label={`${node.label} preview`}>
                <p>
                  {body.name} · v{body.version}
                </p>
                <ol>
                  {body.nodes.map((child) => (
                    <li key={child.id}>
                      <parts.Open value={`${node.id}/${child.id}`} node={node.id} child={child.id}>
                        {child.label}
                        <small>{nodePresentation(child).shortLabel}</small>
                      </parts.Open>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </parts.Group>
    );
  },
  (a, b) =>
    a.node.id === b.node.id &&
    a.node.kind === b.node.kind &&
    a.node.label === b.node.label &&
    a.node.instructions === b.node.instructions &&
    a.node.config === b.node.config &&
    a.node.inputs === b.node.inputs &&
    a.body === b.body &&
    a.baseHeight === b.baseHeight &&
    a.height === b.height &&
    a.open === b.open &&
    a.selected === b.selected &&
    a.start === b.start &&
    a.descriptionKey === b.descriptionKey &&
    a.onToggle === b.onToggle,
);
