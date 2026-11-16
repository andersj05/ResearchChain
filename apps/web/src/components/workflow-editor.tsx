"use client";

import { Button } from "@ui-sdk/react/button";
import { useEffect, useRef, useState } from "react";
import { Plus, PanelLeft, PanelRight, Trash2 } from "lucide-react";
import { WorkspacePanels } from "@/components/workspace-panels";
import { ResearchSettingsEditor } from "@/components/research-settings";
import { nodeKinds, nodePresentation } from "@/components/node-kind";
import { NodeConfiguration } from "@/components/node-configuration";
import {
  addTemplate,
  connectPorts,
  controlOutputs,
  graphAt,
  referenceOf,
  pruneDefinitions,
  removeStep,
  scopeKey,
  updateGraph,
  type GraphScope,
  type TemplateKind,
} from "@/lib/workflow-editing";
import { WorkflowCanvas } from "@/components/canvas/workflow-canvas";
import type { Graph, Workflow, WorkflowNode, SubgraphRef, ExecutionBudgets } from "@/lib/workflow";

type Crumb = { ref: SubgraphRef; via: string };
const defaults: ExecutionBudgets = {
  max_node_executions: 256,
  max_active_seconds: 120,
  max_concurrency: 4,
};

export function WorkflowEditor({
  workflow,
  selected,
  onSelect,
  onChange,
  onSeal,
  disabled,
}: {
  workflow: Workflow;
  selected: string;
  onSelect: (id: string) => void;
  onChange: (workflow: Workflow, group?: string) => void;
  onSeal?: () => void;
  disabled: boolean;
}) {
  const [path, setPath] = useState<Crumb[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [notice, setNotice] = useState("");
  // Undo/import can remove a parent or change its reference. Discard stale navigation.
  const validPath: Crumb[] = [];
  let graph: Graph = workflow;
  for (const crumb of path) {
    const parent = graph.nodes.find((node) => node.id === crumb.via);
    const ref = parent && referenceOf(parent);
    const body = graphAt(workflow, crumb.ref);
    if (!ref || scopeKey(ref) !== scopeKey(crumb.ref) || !body) break;
    validPath.push(crumb);
    graph = body;
  }
  const scope: GraphScope = validPath.at(-1)?.ref ?? null;
  const selectedId = graph.nodes.some((item) => item.id === selected) ? selected : graph.start_node;
  const node = graph.nodes.find((item) => item.id === selectedId);
  const addedStep = useRef<string | null>(null);
  const labelInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (addedStep.current === selectedId && inspectorOpen) {
      document.getElementById(`workflow-node-${selectedId}`)?.focus({ preventScroll: true });
      labelInput.current?.focus();
      labelInput.current?.select();
      addedStep.current = null;
    }
  }, [selectedId, inspectorOpen]);
  function selectNode(id: string) {
    onSeal?.();
    setInspectorOpen(true);
    onSelect(id);
  }
  function changeGraph(next: Graph, group?: string, upgrade = false) {
    const updated = updateGraph(workflow, scope, next);
    onChange(
      upgrade && updated.schema_version === "0.1" ? { ...updated, schema_version: "0.2" } : updated,
      group ? `${scopeKey(scope)}/${selectedId}/${group}` : undefined,
    );
  }
  function editNode(patch: Partial<WorkflowNode>, group?: string) {
    changeGraph(
      {
        ...graph,
        nodes: graph.nodes.map((item) => (item.id === selectedId ? { ...item, ...patch } : item)),
      },
      group,
    );
  }
  function openSubgraph(parent: WorkflowNode, child?: string) {
    const ref = referenceOf(parent);
    if (!ref) return;
    const body = graphAt(workflow, ref);
    if (!body) return;
    if (validPath.length >= 8 || validPath.some((crumb) => scopeKey(crumb.ref) === scopeKey(ref))) {
      setNotice(
        "This reference is recursive or exceeds eight nesting levels. Choose another subgraph version.",
      );
      return;
    }
    setNotice("");
    setPath([...validPath, { ref, via: parent.id }]);
    addedStep.current = child ?? body.start_node;
    selectNode(child ?? body.start_node);
  }
  const pruned = pruneDefinitions(workflow);
  const unusedDefinitions = (workflow.subgraphs?.length ?? 0) - (pruned.subgraphs?.length ?? 0);
  const split = node?.config?.type === "route" || node?.config?.type === "fork";
  const ownedJoin =
    node?.kind === "join" &&
    graph.nodes.some(
      (item) =>
        (item.config?.type === "route" || item.config?.type === "fork") &&
        item.config.join === node.id,
    );
  const uses = scope
    ? [workflow, ...(workflow.subgraphs ?? [])]
        .flatMap((item) => item.nodes)
        .filter((item) => {
          const ref = referenceOf(item);
          return ref && scopeKey(ref) === scopeKey(scope);
        }).length
    : 0;
  return (
    <>
      <nav className="graph-breadcrumbs" aria-label="Graph breadcrumbs">
        <ol>
          <li>
            <button
              type="button"
              disabled={disabled}
              aria-current={!scope ? "page" : undefined}
              onClick={() => {
                setPath([]);
                selectNode(validPath[0]?.via ?? workflow.start_node);
              }}
            >
              {workflow.name || "Root workflow"}
            </button>
          </li>
          {validPath.map((crumb, index) => (
            <li key={`${index}/${scopeKey(crumb.ref)}`}>
              <span aria-hidden="true">/</span>
              <button
                type="button"
                disabled={disabled}
                aria-current={index === validPath.length - 1 ? "page" : undefined}
                onClick={() => {
                  setPath(validPath.slice(0, index + 1));
                  selectNode(validPath[index + 1]?.via ?? graphAt(workflow, crumb.ref)!.start_node);
                }}
              >
                {graphAt(workflow, crumb.ref)?.name} <small>v{crumb.ref.version}</small>
              </button>
            </li>
          ))}
        </ol>
        {scope && (
          <p>
            Editing a shared definition · {uses} draft {uses === 1 ? "reference" : "references"}
          </p>
        )}
      </nav>
      {notice && (
        <p className="error" role="alert">
          {notice}
        </p>
      )}
      <WorkspacePanels
        libraryOpen={libraryOpen}
        inspectorOpen={inspectorOpen}
        onLibraryOpen={setLibraryOpen}
        onInspectorOpen={setInspectorOpen}
        onSeal={onSeal}
        library={
          <fieldset id="step-library" className="library" disabled={disabled} hidden={!libraryOpen}>
            <div className="panel-heading">
              <h2>Steps</h2>
              <span className="count">{graph.nodes.length}</span>
            </div>
            <div className="node-library">
              {(
                [
                  "model",
                  "note",
                  "research",
                  "review",
                  "route",
                  "fork",
                  "loop",
                  "subgraph",
                ] satisfies TemplateKind[]
              ).map((kind) => (
                <Button
                  key={kind}
                  className="library-button"
                  disabled={
                    disabled ||
                    graph.nodes.length + (kind === "route" || kind === "fork" ? 4 : 1) > 128 ||
                    ((kind === "subgraph" || kind === "loop") &&
                      (workflow.subgraphs?.length ?? 0) >= 32)
                  }
                  onClick={() => {
                    const added = addTemplate(workflow, scope, kind, selectedId);
                    onChange(added.workflow);
                    addedStep.current = added.selected;
                    selectNode(added.selected);
                  }}
                >
                  <Plus size={14} aria-hidden="true" />
                  <span>
                    Add {kind === "model" ? "model prompt" : nodeKinds[kind].label.toLowerCase()}
                  </span>
                </Button>
              ))}
            </div>
            <p className="field-hint">
              {node
                ? split
                  ? `Insert after the join for “${node.label}”.`
                  : `Insert ${node.kind === "finish" ? "before" : "after"} “${node.label}”.`
                : "Insert before Finish."}
            </p>
            <div className="outline-heading">
              <h3>{scope ? "In this subgraph" : "In this workflow"}</h3>
              <span className="muted">{graph.edges.length} control connections</span>
            </div>
            <ol className="node-outline">
              {graph.nodes.map((item) => (
                <li key={item.id}>
                  <Button
                    className="outline-row"
                    aria-pressed={selectedId === item.id}
                    onClick={() => {
                      selectNode(item.id);
                      document
                        .getElementById(`workflow-node-${item.id}`)
                        ?.focus({ preventScroll: true });
                    }}
                  >
                    <span className="outline-label">{item.label}</span>
                    <span className={`outline-kind kind-${item.kind}`}>
                      {nodePresentation(item).shortLabel}
                    </span>
                    {graph.start_node === item.id && <small>Start</small>}
                  </Button>
                </li>
              ))}
            </ol>
            <details className="workflow-settings">
              <summary>{scope ? "Subgraph settings" : "Workflow settings"}</summary>
              <label>
                {scope ? "Subgraph name" : "Workflow name"}
                <input
                  value={graph.name}
                  maxLength={120}
                  onChange={(event) =>
                    changeGraph({ ...graph, name: event.target.value }, "graph-name")
                  }
                />
              </label>
              <label>
                First step
                <select
                  value={graph.start_node}
                  onChange={(event) => changeGraph({ ...graph, start_node: event.target.value })}
                >
                  {graph.nodes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="field-hint">
                {scope
                  ? "Changes apply to every reference to this version in the draft. Saved revisions stay pinned."
                  : "Save validates the complete workflow, including every nested definition."}
              </p>
            </details>
            <details className="workflow-settings">
              <summary>Execution limits</summary>
              {(
                [
                  ["max_node_executions", "Maximum step executions", 1, 10000],
                  ["max_active_seconds", "Maximum active seconds", 0.1, 3600],
                  ["max_concurrency", "Maximum parallel steps", 1, 16],
                ] as const
              ).map(([key, label, min, max]) => (
                <label key={key}>
                  {label}
                  <input
                    type="number"
                    min={min}
                    max={max}
                    step={key === "max_active_seconds" ? "any" : 1}
                    value={(workflow.budgets ?? defaults)[key]}
                    onChange={(event) =>
                      onChange(
                        {
                          ...workflow,
                          schema_version: workflow.schema_version === "0.3" ? "0.3" : "0.2",
                          budgets: {
                            ...(workflow.budgets ?? defaults),
                            [key]: event.target.valueAsNumber || min,
                          },
                        },
                        `budget/${key}`,
                      )
                    }
                  />
                </label>
              ))}
              <p className="field-hint">
                Shared across the entire run, including subgraphs and loops. Time spent waiting for
                a completed human review pause is excluded.
              </p>
            </details>
            <ResearchSettingsEditor workflow={workflow} onChange={onChange} />
            {!!workflow.subgraphs?.length && (
              <details className="workflow-settings">
                <summary>Definitions ({workflow.subgraphs.length})</summary>
                <p className="field-hint">
                  {unusedDefinitions} unused versions in this draft. Removing them leaves saved
                  revisions and their runs unchanged.
                </p>
                <Button
                  className="button small config-actions"
                  disabled={disabled || !unusedDefinitions}
                  onClick={() => onChange(pruned)}
                >
                  Remove unused definitions
                </Button>
              </details>
            )}
          </fieldset>
        }
        canvas={
          <div className="canvas-panel" inert={disabled}>
            <div className="canvas-heading">
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
              <span
                className="canvas-model-summary"
                aria-label="Configured model"
                title="One model is shared by all model steps. Choose it in Run workflow."
              >
                {workflow.research ? (
                  <>
                    Model · <strong>{workflow.research.model}</strong>
                  </>
                ) : (
                  "No model configured"
                )}
              </span>
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
              key={scopeKey(scope)}
              workflow={graph}
              definitions={workflow.subgraphs}
              selected={selectedId}
              onSelect={selectNode}
              onOpen={openSubgraph}
              onConnect={(from, to) =>
                changeGraph(connectPorts(graph, from, to), undefined, from.type !== "control")
              }
              onMove={(positions, details) =>
                changeGraph(
                  {
                    ...graph,
                    nodes: graph.nodes.map((item) => {
                      const position = positions[item.id] ?? item.position;
                      return position.x === item.position.x && position.y === item.position.y
                        ? item
                        : { ...item, position };
                    }),
                  },
                  details.reason === "move-key" ? "nudge" : undefined,
                )
              }
            />
            <p id="canvas-help" className="canvas-help">
              Drag a card to move · Alt + arrows to nudge · Drag ports to connect · Enter on a port,
              arrows, Enter to connect · Escape cancels · Scroll to pan · Ctrl/⌘ + scroll to zoom
            </p>
          </div>
        }
        inspector={
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
                    onChange={(event) => editNode({ label: event.target.value }, "label")}
                  />
                </label>
                <label>
                  Step type
                  <select
                    disabled={node.kind !== "note" && node.kind !== "review"}
                    value={node.kind}
                    onChange={(event) =>
                      editNode({
                        kind: event.target.value as WorkflowNode["kind"],
                        inputs: {},
                        config: null,
                      })
                    }
                  >
                    {Object.entries(nodeKinds)
                      .filter(
                        ([kind]) => kind === node.kind || kind === "note" || kind === "review",
                      )
                      .map(([kind, details]) => (
                        <option key={kind} value={kind}>
                          {kind === node.kind ? nodePresentation(node).label : details.label}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Instructions
                  <textarea
                    rows={4}
                    maxLength={6000}
                    value={node.instructions}
                    onChange={(event) =>
                      editNode({ instructions: event.target.value }, "instructions")
                    }
                  />
                </label>
                {node.kind === "note" && (
                  <p className="field-hint">
                    Notes copy text; they do not call a model. Use Add model prompt for AI
                    instructions.
                  </p>
                )}
                {node.kind === "research" && (
                  <p className="field-hint" aria-label="Step model">
                    This step uses{" "}
                    <strong>{workflow.research?.model ?? "an unconfigured model"}</strong> through
                    your ChatGPT plan. All model steps share this selection. Change it in Run
                    workflow.
                  </p>
                )}
                <NodeConfiguration
                  workflow={workflow}
                  graph={graph}
                  node={node}
                  scope={scope}
                  onGraph={(next, group) => changeGraph(next, group, true)}
                  onWorkflow={onChange}
                  onEdit={editNode}
                  onOpen={openSubgraph}
                />
                <fieldset className="config-fields">
                  <legend>Control connections</legend>
                  {controlOutputs(node).map((port) => (
                    <label key={port}>
                      {port === "next" ? "Next step" : `Next step (${port})`}
                      <select
                        value={
                          graph.edges.find(
                            (edge) =>
                              edge.source === node.id && (edge.source_port ?? "next") === port,
                          )?.target ?? ""
                        }
                        onChange={(event) =>
                          changeGraph({
                            ...graph,
                            edges: [
                              ...graph.edges.filter(
                                (edge) =>
                                  edge.source !== node.id || (edge.source_port ?? "next") !== port,
                              ),
                              ...(event.target.value
                                ? [
                                    {
                                      source: node.id,
                                      target: event.target.value,
                                      source_port: port,
                                      target_port: "in",
                                    },
                                  ]
                                : []),
                            ],
                          })
                        }
                      >
                        <option value="">No connection</option>
                        {graph.nodes
                          .filter((item) => item.id !== node.id)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.label}
                            </option>
                          ))}
                      </select>
                    </label>
                  ))}
                  <p className="field-hint">
                    {node.kind === "finish"
                      ? "Finish ends this graph."
                      : "Draw from an existing output to reconnect it. Each control output must lead to a step."}
                  </p>
                </fieldset>
                <details className="node-advanced">
                  <summary>Step identifier</summary>
                  <code>{node.id}</code>
                </details>
                <Button
                  className="button danger"
                  disabled={disabled || node.kind === "finish" || !!ownedJoin}
                  onClick={() => {
                    const next = removeStep(graph, node.id);
                    const successor = graph.edges.find((edge) => edge.source === node.id)?.target;
                    changeGraph(next);
                    selectNode(
                      next.nodes.some((item) => item.id === successor)
                        ? successor!
                        : next.start_node,
                    );
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  {split ? "Remove split and branches" : "Remove step"}
                </Button>
                {ownedJoin && (
                  <p className="field-hint">
                    This join belongs to a split. Remove the split to remove its branches and join
                    together.
                  </p>
                )}
              </>
            ) : (
              <p className="muted">Select a step to edit its instructions and connections.</p>
            )}
          </fieldset>
        }
      />
    </>
  );
}
