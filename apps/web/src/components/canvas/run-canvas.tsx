"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { createParts, usePart, usePrimitive } from "@ui-sdk/react/primitive";
import { Maximize, Minus, Plus } from "lucide-react";
import { nodePresentation } from "../node-kind";
import type { Graph } from "@/lib/workflow";
import { connectionsFor } from "@/lib/workflow-editing";
import type { StepStatus } from "@/lib/run-inspection";
import { curve, workflowCanvas } from "./primitive";

const parts = createParts(workflowCanvas, {
  world: "div",
  group: "div",
  inspect: "button",
  fit: "button",
  zoomIn: "button",
  zoomOut: "button",
});
const card = { width: 222, height: 94 };

export function RunCanvas({
  graph,
  prefix,
  selected,
  states,
  onSelect,
}: {
  graph: Graph;
  prefix: string;
  selected: string;
  states: Map<string, StepStatus>;
  onSelect: (path: string) => void;
}) {
  const marker = useId();
  const surface = useRef<HTMLDivElement>(null);
  const [dataLinks, setDataLinks] = useState(false);
  const positions = Object.fromEntries(graph.nodes.map((node) => [node.id, node.position]));
  const canvas = usePrimitive(workflowCanvas, {
    positions,
    sizes: Object.fromEntries(graph.nodes.map((node) => [node.id, card])),
    ports: {},
    onSelect: (id) => onSelect(`${prefix}/${id}`),
  });
  useLayoutEffect(() => {
    const el = surface.current;
    if (!el) return;
    const center = () => canvas.api.fit(selected);
    center();
    const observer = new ResizeObserver(center);
    observer.observe(el);
    return () => observer.disconnect();
  }, [canvas, prefix, selected]);
  const links = connectionsFor(graph);
  return usePart(
    canvas,
    "root",
    {},
    {
      ref: surface,
      className: "canvas run-canvas",
      role: "region",
      "aria-label": "Run workflow graph",
      "aria-describedby": marker + "-help",
      children: (
        <>
          <p className="sr-only" id={marker + "-help"}>
            Pan the graph with the arrow keys. Select a step to inspect its output. Fit view shows
            the whole workflow.
          </p>
          <parts.World className="canvas-world">
            <svg className="connections" aria-hidden="true">
              <defs>
                <marker
                  id={marker}
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M0 0 L10 5 L0 10z" fill="context-stroke" />
                </marker>
              </defs>
              {links
                .filter((link) => dataLinks || link.type === "control")
                .map((link) => {
                  const from = link.from.split(":")[0]!;
                  const to = link.to.split(":")[0]!;
                  const a = positions[from],
                    b = positions[to];
                  if (!a || !b) return null;
                  const y = link.type === "control" ? 45 : 80;
                  return (
                    <path
                      key={`${link.from}/${link.to}`}
                      className={`connection-${link.type}`}
                      data-selected={selected === from || selected === to || undefined}
                      markerEnd={`url(#${marker})`}
                      d={curve({ x: a.x + card.width, y: a.y + y }, { x: b.x - 3, y: b.y + y })}
                    />
                  );
                })}
            </svg>
            {graph.nodes.map((node) => {
              const status = states.get(`${prefix}/${node.id}`) ?? "Not reached";
              return (
                <parts.Group key={node.id} value={node.id} className="run-map-group" style={card}>
                  <parts.Inspect
                    value={node.id}
                    className="run-map-step"
                    aria-label={`Inspect ${node.label}`}
                    aria-description={`${nodePresentation(node).label}. ${status}.`}
                    aria-pressed={node.id === selected}
                    data-status={status}
                  >
                    <span className="run-node-kind">{nodePresentation(node).shortLabel}</span>
                    <strong>{node.label}</strong>
                    <span className="step-status" data-status={status}>
                      {status}
                    </span>
                  </parts.Inspect>
                </parts.Group>
              );
            })}
          </parts.World>
          <div className="canvas-toolbar run-canvas-tools" role="group" aria-label="Run graph view">
            <parts.ZoomOut className="button icon-button" aria-label="Zoom out of run graph">
              <Minus size={14} aria-hidden />
            </parts.ZoomOut>
            <parts.ZoomIn className="button icon-button" aria-label="Zoom in to run graph">
              <Plus size={14} aria-hidden />
            </parts.ZoomIn>
            <parts.Fit className="button" aria-label="Fit run graph to view">
              <Maximize size={13} aria-hidden />
              Fit view
            </parts.Fit>
            {links.some((link) => link.type !== "control") && (
              <label>
                <input
                  type="checkbox"
                  checked={dataLinks}
                  onChange={(e) => setDataLinks(e.target.checked)}
                />
                Data links
              </label>
            )}
          </div>
        </>
      ),
    },
    "div",
  );
}
