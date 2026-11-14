"use client";

import { Button } from "@ui-sdk/react/button";
import { useState } from "react";
import { Plus, PanelLeft, PanelRight, SlidersHorizontal, Trash2, ChevronRight } from "lucide-react";
import { NodeKindIcon, nodeKinds } from "@/components/node-kind";
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
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  function selectNode(id: string) {
    setInspectorOpen(true);
    onSelect(id);
  }
  function editNode(patch: Partial<WorkflowNode>) {
    onChange({
      ...workflow,
      nodes: workflow.nodes.map((item) => (item.id === selected ? { ...item, ...patch } : item)),
    });
  }
  return (
    <div
      className={`editor-grid ${libraryOpen ? "" : "library-closed"} ${inspectorOpen ? "" : "inspector-closed"}`}
    >
      <fieldset id="step-library" className="library" disabled={disabled} hidden={!libraryOpen}>
        <div className="panel-heading">
          <h2>Steps</h2>
          <span className="count">{workflow.nodes.length}</span>
        </div>
        <div className="node-library">
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
                      position: { x: 100, y: 340 + Math.max(0, workflow.nodes.length - 4) * 40 },
                    },
                  ],
                });
                selectNode(id);
              }}
            >
              <NodeKindIcon kind={kind} />
              <span>
                <strong>{nodeKinds[kind].label}</strong>
                <small>{kind === "note" ? "Capture an idea" : "Pause for a decision"}</small>
              </span>
              <Plus size={14} aria-hidden="true" />
            </Button>
          ))}
        </div>
        <p className="field-hint">Add a step, then connect it in the inspector.</p>
        <div className="outline-heading">
          <h3>In this workflow</h3>
          <span className="muted">{workflow.edges.length} connections</span>
        </div>
        <ol className="node-outline">
          {workflow.nodes.map((item) => (
            <li key={item.id}>
              <Button
                className="outline-row"
                aria-pressed={selected === item.id}
                onClick={() => {
                  selectNode(item.id);
                  document
                    .getElementById(`workflow-node-${item.id}`)
                    ?.focus({ preventScroll: true });
                }}
              >
                <NodeKindIcon kind={item.kind} />
                <span>{item.label}</span>
                {workflow.start_node === item.id && <small>Start</small>}
              </Button>
            </li>
          ))}
        </ol>
        <details className="workflow-settings">
          <summary>
            <SlidersHorizontal size={15} aria-hidden="true" />
            Workflow settings
          </summary>
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
          <p className="field-hint">A connected chain ending at Finish.</p>
        </details>
      </fieldset>
      <div className="canvas-panel" inert={disabled}>
        <div className="canvas-heading">
          <div className="actions">
            <Button
              className="button icon-button ghost"
              aria-label="Toggle step library"
              aria-expanded={libraryOpen}
              aria-controls="step-library"
              onClick={() => setLibraryOpen(!libraryOpen)}
            >
              <PanelLeft size={16} aria-hidden="true" />
            </Button>
            <span>Workflow</span>
            <ChevronRight size={13} aria-hidden="true" />
            <span className="muted">Editor</span>
          </div>
          <Button
            className="button icon-button ghost"
            aria-label="Toggle node inspector"
            aria-expanded={inspectorOpen}
            aria-controls="node-inspector"
            onClick={() => setInspectorOpen(!inspectorOpen)}
          >
            <PanelRight size={16} aria-hidden="true" />
          </Button>
        </div>
        <WorkflowCanvas
          workflow={workflow}
          selected={selected}
          onSelect={selectNode}
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
      <fieldset
        id="node-inspector"
        className="inspector"
        aria-label="Node inspector"
        disabled={disabled}
        hidden={!inspectorOpen}
      >
        <div className="panel-heading">
          <h2>Step details</h2>
          <SlidersHorizontal size={15} aria-hidden="true" />
        </div>
        {node ? (
          <>
            <div className="inspector-heading">
              <NodeKindIcon kind={node.kind} />
              <div>
                <h3>{nodeKinds[node.kind].label}</h3>
                <p className="field-hint">{nodeKinds[node.kind].description}</p>
              </div>
            </div>
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
                rows={6}
                maxLength={6000}
                value={node.instructions}
                onChange={(event) => editNode({ instructions: event.target.value })}
              />
            </label>
            <label className="connection-field">
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
            <p className="field-hint">
              {node.kind === "finish"
                ? "Finish ends the workflow. Leave it unconnected."
                : "Choose the step that follows this one."}
            </p>
            <details className="node-advanced">
              <summary>Step identifier</summary>
              <code>{node.id}</code>
            </details>
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
              <Trash2 size={14} aria-hidden="true" />
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
