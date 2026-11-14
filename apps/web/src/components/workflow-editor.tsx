"use client";

import { Button } from "@ui-sdk/react/button";
import { WorkflowCanvas } from "@/components/canvas/workflow-canvas";
import type { Workflow, WorkflowNode } from "@/lib/workflow";

export function WorkflowEditor({
  workflow,
  selected,
  onSelect,
  onChange,
  disabled,
}: {
  workflow: Workflow;
  selected: string;
  onSelect: (id: string) => void;
  onChange: (workflow: Workflow) => void;
  disabled: boolean;
}) {
  const node = workflow.nodes.find((item) => item.id === selected);
  function editNode(patch: Partial<WorkflowNode>) {
    onChange({
      ...workflow,
      nodes: workflow.nodes.map((item) => (item.id === selected ? { ...item, ...patch } : item)),
    });
  }
  return (
    <div className="editor-grid">
      <fieldset className="library" disabled={disabled}>
        <h2>Workflow settings</h2>
        <label>
          Workflow name
          <input
            value={workflow.name}
            maxLength={120}
            onChange={(event) => onChange({ ...workflow, name: event.target.value })}
          />
        </label>
        <label>
          Start node
          <select
            value={workflow.start_node}
            onChange={(event) => onChange({ ...workflow, start_node: event.target.value })}
          >
            {workflow.nodes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <div className="node-library">
          <h3>Add a step</h3>
          {(["note", "review"] as const).map((kind) => (
            <Button
              key={kind}
              className="library-button"
              disabled={disabled || workflow.nodes.length >= 32}
              onClick={() => {
                const id = `${kind}-${crypto.randomUUID().slice(0, 8)}`;
                onChange({
                  ...workflow,
                  nodes: [
                    ...workflow.nodes,
                    {
                      id,
                      kind,
                      label: kind === "note" ? "New research note" : "New human review",
                      instructions: "",
                      position: { x: 100, y: 340 },
                    },
                  ],
                });
                onSelect(id);
              }}
            >
              <span aria-hidden="true">{kind === "note" ? "◇" : "◎"}</span>
              {kind === "note" ? "Research note" : "Human review"}
              <span aria-hidden="true">+</span>
            </Button>
          ))}
        </div>
        <p className="muted scope-note">
          Connect each step in the inspector. This version supports a single chain ending at Finish.
        </p>
      </fieldset>
      <div className="canvas-panel" inert={disabled}>
        <WorkflowCanvas
          workflow={workflow}
          selected={selected}
          onSelect={onSelect}
          onMove={(positions) =>
            onChange({
              ...workflow,
              nodes: workflow.nodes.map((item) => ({
                ...item,
                position: positions[item.id] ?? item.position,
              })),
            })
          }
        />
        <p id="canvas-help" className="canvas-help">
          Drag to move · Alt + arrows to nudge · Scroll to pan · Ctrl/⌘ + scroll to zoom
        </p>
      </div>
      <fieldset className="inspector" aria-label="Node inspector" disabled={disabled}>
        <p className="eyebrow">Selected step</p>
        {node ? (
          <>
            <h2>{node.label}</h2>
            <span className="code-label">{node.id}</span>
            <label>
              Label
              <input
                value={node.label}
                maxLength={100}
                onChange={(event) => editNode({ label: event.target.value })}
              />
            </label>
            <label>
              Node type
              <select
                value={node.kind}
                onChange={(event) => editNode({ kind: event.target.value as WorkflowNode["kind"] })}
              >
                <option value="note">Research note</option>
                <option value="review">Human review</option>
                <option value="finish">Finish</option>
              </select>
            </label>
            <label>
              Instructions
              <textarea
                rows={4}
                maxLength={6000}
                value={node.instructions}
                onChange={(event) => editNode({ instructions: event.target.value })}
              />
            </label>
            <label>
              Next node
              <select
                value={workflow.edges.find((edge) => edge.source === node.id)?.target ?? ""}
                onChange={(event) =>
                  onChange({
                    ...workflow,
                    edges: [
                      ...workflow.edges.filter((edge) => edge.source !== node.id),
                      ...(event.target.value
                        ? [{ source: node.id, target: event.target.value }]
                        : []),
                    ],
                  })
                }
              >
                <option value="">No connection</option>
                {workflow.nodes
                  .filter((item) => item.id !== node.id)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
              </select>
            </label>
            <Button
              className="button danger"
              disabled={disabled}
              onClick={() => {
                onChange({
                  ...workflow,
                  nodes: workflow.nodes.filter((item) => item.id !== node.id),
                  edges: workflow.edges.filter(
                    (edge) => edge.source !== node.id && edge.target !== node.id,
                  ),
                });
                onSelect("");
              }}
            >
              Remove node
            </Button>
          </>
        ) : (
          <p className="muted">Select a step to edit its instructions and connections.</p>
        )}
      </fieldset>
    </div>
  );
}
