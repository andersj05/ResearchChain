"use client";

import { Button } from "@ui-sdk/react/button";
import { useEffect, useRef, useState } from "react";
import { Plus, PanelLeft, PanelRight, Trash2 } from "lucide-react";
import { nodeKinds } from "@/components/node-kind";
import { insertStep, removeStep } from "@/lib/workflow-editing";
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
  const structured = workflow.schema_version === "0.2";
  const node = workflow.nodes.find((item) => item.id === selected);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const addedStep = useRef<string | null>(null);
  const labelInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (addedStep.current === selected && inspectorOpen) {
      document.getElementById(`workflow-node-${selected}`)?.focus({ preventScroll: true });
      labelInput.current?.focus();
      labelInput.current?.select();
      addedStep.current = null;
    }
  }, [selected, inspectorOpen]);
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
              disabled={disabled || structured || workflow.nodes.length >= 32}
              onClick={() => {
                const id = `${kind}-${crypto.randomUUID().slice(0, 8)}`;
                onChange(
                  insertStep(
                    workflow,
                    {
                      id,
                      kind,
                      label: kind === "note" ? "New research note" : "New human review",
                      instructions: "",
                      position: { x: 100, y: 340 },
                    },
                    selected,
                  ),
                );
                addedStep.current = id;
                selectNode(id);
              }}
            >
              <Plus size={14} aria-hidden="true" />
              <span>Add {nodeKinds[kind].label.toLowerCase()}</span>
            </Button>
          ))}
        </div>
        <p className="field-hint">
          {node
            ? `Insert ${node.kind === "finish" ? "before" : "after"} “${node.label}”.`
            : "Insert before Finish."}
        </p>
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
                <span className="outline-label">{item.label}</span>
                <span className={`outline-kind kind-${item.kind}`}>
                  {nodeKinds[item.kind].shortLabel}
                </span>
                {workflow.start_node === item.id && <small>Start</small>}
              </Button>
            </li>
          ))}
        </ol>
        <details className="workflow-settings">
          <summary>Workflow settings</summary>
          <label>
            Workflow name
            <input
              value={workflow.name}
              maxLength={120}
              onChange={(event) => onChange({ ...workflow, name: event.target.value })}
            />
          </label>
          <label>
            First step
            <select
              disabled={structured}
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
          <p className="field-hint">
            {structured
              ? "Branching workflow with pinned subgraphs."
              : "A connected chain ending at Finish."}
          </p>
        </details>
      </fieldset>
      <div className="canvas-panel" inert={disabled}>
        <div className="canvas-heading">
          <div className="actions">
            <Button
              className="button ghost"
              aria-label="Toggle steps"
              aria-expanded={libraryOpen}
              aria-controls="step-library"
              onClick={() => setLibraryOpen(!libraryOpen)}
            >
              <PanelLeft size={16} aria-hidden="true" />
              Steps
            </Button>
          </div>
          <Button
            className="button ghost"
            aria-label="Toggle details"
            aria-expanded={inspectorOpen}
            aria-controls="node-inspector"
            onClick={() => setInspectorOpen(!inspectorOpen)}
          >
            <PanelRight size={16} aria-hidden="true" />
            Details
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
        </div>
        {node ? (
          <>
            <label>
              Step name
              <input
                ref={labelInput}
                value={node.label}
                maxLength={100}
                onChange={(event) => editNode({ label: event.target.value })}
              />
            </label>
            <label>
              Step type
              <select
                disabled={structured}
                value={node.kind}
                onChange={(event) => editNode({ kind: event.target.value as WorkflowNode["kind"] })}
              >
                <option value="note">Research note</option>
                <option value="review">Human review</option>
                <option value="finish">Finish</option>
                {structured &&
                  Object.entries(nodeKinds)
                    .filter(([kind]) => !["note", "review", "finish"].includes(kind))
                    .map(([kind, details]) => (
                      <option key={kind} value={kind}>
                        {details.label}
                      </option>
                    ))}
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
            <label className="connection-field" hidden={structured}>
              Next step
              <select
                value={workflow.edges.find((edge) => edge.source === node.id)?.target ?? ""}
                onChange={(event) =>
                  onChange({
                    ...workflow,
                    edges: [
                      ...workflow.edges.filter((edge) => edge.source !== node.id),
                      ...(event.target.value
                        ? [
                            {
                              source: node.id,
                              target: event.target.value,
                              source_port: "next",
                              target_port: "in",
                            },
                          ]
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
              {structured
                ? workflow.edges
                    .filter((edge) => edge.source === node.id)
                    .map(
                      (edge) =>
                        `${edge.source_port ?? "next"} → ${workflow.nodes.find((item) => item.id === edge.target)?.label ?? edge.target}`,
                    )
                    .join(" · ")
                : node.kind === "finish"
                  ? "Finish ends the workflow. Leave it unconnected."
                  : "Choose the step that follows this one."}
            </p>
            <details className="node-advanced">
              <summary>Step identifier</summary>
              <code>{node.id}</code>
            </details>
            <Button
              className="button danger"
              disabled={disabled || structured}
              onClick={() => {
                const next =
                  workflow.edges.find((edge) => edge.source === node.id)?.target ??
                  workflow.edges.find((edge) => edge.target === node.id)?.source ??
                  "";
                onChange(removeStep(workflow, node.id));
                onSelect(next);
              }}
            >
              <Trash2 size={14} aria-hidden="true" />
              Remove step
            </Button>
          </>
        ) : (
          <p className="muted">Select a step to edit its instructions and connections.</p>
        )}
      </fieldset>
    </div>
  );
}
