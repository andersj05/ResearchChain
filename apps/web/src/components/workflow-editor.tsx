"use client";

import { Button } from "@ui-sdk/react/button";
import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { ArrowLeft, Copy, Plus, PanelLeft, PanelRight, Trash2 } from "lucide-react";
import { useOwner } from "@/components/access-context";
import { WorkspacePanels } from "@/components/workspace-panels";
import { ExecutionLimitFields } from "@/components/execution-limits";
import { ResearchSettingsEditor } from "@/components/research-settings";
import { ModelPicker, type ModelCatalog } from "@/components/model-picker";
import { nodeKinds, nodePresentation } from "@/components/node-kind";
import { NodeConfiguration } from "@/components/node-configuration";
import { ReviewHandoff } from "@/components/review-handoff";
import { StepBranchPaths } from "@/components/step-branch-paths";
import { StepOutputBindings } from "@/components/step-output-bindings";
import { WorkflowModelPlan } from "@/components/workflow-model-plan";
import { WorkflowOutline } from "@/components/workflow-outline";
import { WorkflowReviewPlan } from "@/components/workflow-review-plan";
import { WorkflowStepSearch } from "@/components/workflow-step-search";
import { WorkflowStepText } from "@/components/workflow-step-text";
import { DefinitionReferences } from "@/components/definition-references";
import {
  addTemplate,
  connectPorts,
  controlOutputs,
  duplicateStep,
  graphAt,
  insertionPoint,
  prepareNestedStepCopy,
  referenceOf,
  pruneDefinitions,
  removeStep,
  scopeKey,
  updateGraph,
  type GraphCrumb,
  type GraphScope,
  type TemplateKind,
} from "@/lib/workflow-editing";
import { WorkflowCanvas, type ConnectionView } from "@/components/canvas/workflow-canvas";
import { ownerStoragePrefix } from "@/lib/access";
import {
  defaultReviewQuestion,
  type Graph,
  type SubgraphRef,
  type Workflow,
  type WorkflowNode,
} from "@/lib/workflow";

export type WorkflowEditorNavigation = {
  openStep: (id: string, path: GraphCrumb[], field?: string) => void;
};

type StepVisit = { id: string; path: GraphCrumb[] };

function resolveGraphPath(workflow: Workflow, path: GraphCrumb[]) {
  const validPath: GraphCrumb[] = [];
  let graph: Graph = workflow;
  for (const crumb of path) {
    const parent = graph.nodes.find((node) => node.id === crumb.via);
    const ref = parent && referenceOf(parent);
    const body = graphAt(workflow, crumb.ref);
    if (!ref || scopeKey(ref) !== scopeKey(crumb.ref) || !body) break;
    validPath.push(crumb);
    graph = body;
  }
  return { graph, validPath };
}

function samePath(left: GraphCrumb[], right: GraphCrumb[]) {
  return (
    left.length === right.length &&
    left.every((crumb, index) => {
      const other = right[index];
      return !!other && crumb.via === other.via && scopeKey(crumb.ref) === scopeKey(other.ref);
    })
  );
}

function sameVisit(left: StepVisit, right: StepVisit) {
  return left.id === right.id && samePath(left.path, right.path);
}

function returnDestination(workflow: Workflow, visits: StepVisit[], current: StepVisit) {
  for (let index = visits.length - 1; index >= 0; index--) {
    const visit = visits[index]!;
    if (sameVisit(visit, current)) continue;
    const scope = resolveGraphPath(workflow, visit.path);
    // The closest surviving ancestor is useful for display, but is not a valid return destination.
    if (scope.validPath.length !== visit.path.length) continue;
    const step = scope.graph.nodes.find((node) => node.id === visit.id);
    if (step) return { visit, step, index };
  }
}

export function WorkflowEditor({
  catalog,
  workflow,
  selected,
  initialPath = [],
  navigationRef,
  onSelect,
  onChange,
  onSeal,
  disabled,
}: {
  catalog: ModelCatalog;
  workflow: Workflow;
  selected: string;
  initialPath?: GraphCrumb[];
  navigationRef?: Ref<WorkflowEditorNavigation>;
  onSelect: (id: string) => void;
  onChange: (workflow: Workflow, group?: string) => void;
  onSeal?: () => void;
  disabled: boolean;
}) {
  const { owner } = useOwner();
  const connectionViewKey = `${ownerStoragePrefix(owner)}.build-visible-connections`;
  const [connectionChoice, setConnectionChoice] = useState<{ key: string; view: ConnectionView }>();
  const connectionView =
    connectionChoice?.key === connectionViewKey ? connectionChoice.view : "all";
  useEffect(() => {
    // Restore after hydration and keep any choice made before this read.
    const frame = requestAnimationFrame(() => {
      let preference: ConnectionView = "all";
      try {
        const saved = localStorage.getItem(connectionViewKey);
        if (saved === "control" || saved === "data") preference = saved;
      } catch {
        // The connection picker also works without local storage.
      }
      setConnectionChoice((choice) =>
        choice?.key === connectionViewKey ? choice : { key: connectionViewKey, view: preference },
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [connectionViewKey]);

  function changeConnectionView(view: ConnectionView) {
    setConnectionChoice({ key: connectionViewKey, view });
    try {
      localStorage.setItem(connectionViewKey, view);
    } catch {
      // Keep using the selected view in the editor for this session.
    }
  }

  const [path, setPath] = useState(initialPath);
  const [stepVisits, setStepVisits] = useState<StepVisit[]>([]);
  const [beforeStep, setBeforeStep] = useState<StepVisit>();
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [notice, setNotice] = useState("");
  const breadcrumbId = useId();
  // Undo/import can remove a parent or change its reference. Discard stale navigation.
  const { graph, validPath } = resolveGraphPath(workflow, path);
  const scope: GraphScope = validPath.at(-1)?.ref ?? null;
  const selectedId = graph.nodes.some((item) => item.id === selected) ? selected : graph.start_node;
  const node = graph.nodes.find((item) => item.id === selectedId);
  const currentVisit = { id: selectedId, path: validPath };
  const returnTo = returnDestination(workflow, stepVisits, currentVisit);
  const stepToFocus = useRef<string | null>(null);
  const fieldToFocus = useRef<string | null>(null);
  const inspector = useRef<HTMLFieldSetElement>(null);
  const labelInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (stepToFocus.current === selectedId && inspectorOpen) {
      document.getElementById(`workflow-node-${selectedId}`)?.focus({ preventScroll: true });
      const field =
        fieldToFocus.current && inspector.current?.elements.namedItem(fieldToFocus.current);
      if (field instanceof HTMLSelectElement || field instanceof HTMLFieldSetElement) {
        field.focus();
      } else {
        labelInput.current?.focus();
        labelInput.current?.select();
      }
      stepToFocus.current = null;
      fieldToFocus.current = null;
    }
  }, [selectedId, inspectorOpen, path]);
  function selectNode(id: string) {
    onSeal?.();
    setInspectorOpen(true);
    setBeforeStep(undefined);
    onSelect(id);
  }
  function focusStep(id: string, location: GraphCrumb[], field?: string) {
    stepToFocus.current = id;
    fieldToFocus.current = field ?? null;
    setNotice("");
    // Repeat visits still need to move focus from the link to the inspector.
    setPath([...location]);
    selectNode(id);
  }
  function openStep(id: string, location: GraphCrumb[], field?: string) {
    if (node && !sameVisit(currentVisit, { id, path: location })) {
      setStepVisits((visits) => {
        const latest = visits.at(-1);
        return latest && sameVisit(latest, currentVisit) ? visits : [...visits, currentVisit];
      });
    }
    focusStep(id, location, field);
  }
  useImperativeHandle(navigationRef, () => ({ openStep }));

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
  function subgraphPath(parentId: string, ref: SubgraphRef) {
    if (validPath.length >= 8 || validPath.some((crumb) => scopeKey(crumb.ref) === scopeKey(ref)))
      return;
    return [...validPath, { ref, via: parentId }];
  }
  function openSubgraph(parent: WorkflowNode, child?: string) {
    const ref = referenceOf(parent);
    if (!ref) return;
    const body = graphAt(workflow, ref);
    if (!body) return;
    const nextPath = subgraphPath(parent.id, ref);
    if (!nextPath) {
      setNotice(
        "This reference is recursive or exceeds eight nesting levels. Choose another subgraph version.",
      );
      return;
    }
    setNotice("");
    setPath(nextPath);
    stepToFocus.current = child ?? body.start_node;
    selectNode(child ?? body.start_node);
  }
  const loopRef = node?.config?.type === "loop" ? node.config.ref : undefined;
  const loopSourcePath =
    loopRef &&
    graph.nodes.filter((item) => item.id === selectedId).length === 1 &&
    workflow.subgraphs?.filter((definition) => scopeKey(definition) === scopeKey(loopRef))
      .length === 1
      ? subgraphPath(selectedId, loopRef)
      : undefined;
  const pruned = pruneDefinitions(workflow);
  const unusedDefinitions = (workflow.subgraphs?.length ?? 0) - (pruned.subgraphs?.length ?? 0);
  const nestedCopy =
    node && (node.kind === "loop" || node.kind === "subgraph")
      ? prepareNestedStepCopy(workflow, scope, node)
      : null;
  const split = node?.config?.type === "route" || node?.config?.type === "fork";
  const canInsertBefore = !!insertionPoint(graph, selectedId, "before");
  const insertBefore =
    canInsertBefore && beforeStep?.id === selectedId && samePath(beforeStep.path, validPath);
  const placement = insertBefore ? "before" : "default";
  const canInsert = !!insertionPoint(graph, selectedId, placement);
  const ownedJoin =
    node?.kind === "join" &&
    graph.nodes.some(
      (item) =>
        (item.config?.type === "route" || item.config?.type === "fork") &&
        item.config.join === node.id,
    );
  return (
    <>
      {(scope || returnTo) && (
        <div className="graph-breadcrumbs">
          {returnTo && (
            <Button
              className="button small ghost"
              aria-label={`Return to step ${returnTo.step.label || returnTo.step.id}`}
              disabled={disabled}
              onClick={() => {
                setStepVisits((visits) => visits.slice(0, returnTo.index));
                focusStep(returnTo.visit.id, returnTo.visit.path);
              }}
            >
              <ArrowLeft size={14} aria-hidden="true" /> Return to step
            </Button>
          )}
          {scope && (
            <nav aria-label="Graph breadcrumbs">
              <ol>
                {[null, ...validPath.map(({ ref }) => ref)].map((ref, depth) => {
                  const destinationGraph = graphAt(workflow, ref);
                  if (!destinationGraph) return null;
                  const isCurrent = depth === validPath.length;
                  const id = validPath[depth]?.via ?? destinationGraph.start_node;
                  const step = destinationGraph.nodes.find((node) => node.id === id);
                  const label = step?.label || id;
                  const action = isCurrent
                    ? `Go to the first step, ${label}`
                    : `Return to ${label}`;
                  const descriptionId = `${breadcrumbId}-${depth}`;
                  return (
                    <li key={`${depth}/${scopeKey(ref)}`}>
                      {ref && <span aria-hidden="true">/</span>}
                      <button
                        type="button"
                        disabled={disabled || !step}
                        aria-current={isCurrent ? "page" : undefined}
                        aria-describedby={descriptionId}
                        title={action}
                        onClick={() => focusStep(id, validPath.slice(0, depth))}
                      >
                        {destinationGraph.name || (ref ? ref.id : "Root workflow")}
                        {ref && (
                          <>
                            {" "}
                            <small>v{ref.version}</small>
                          </>
                        )}
                      </button>
                      <span id={descriptionId} className="sr-only">
                        {action}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </nav>
          )}
          {scope && (
            <DefinitionReferences
              key={scopeKey(scope)}
              workflow={workflow}
              definition={scope}
              disabled={disabled}
              onOpen={openStep}
            />
          )}
        </div>
      )}
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
            <WorkflowStepSearch
              workflow={workflow}
              scope={scope}
              selected={selectedId}
              onSelect={openStep}
              palette={
                <div className="step-palette">
                  <label className="step-placement">
                    Insert position
                    <select
                      value={placement}
                      disabled={!canInsertBefore}
                      onChange={(event) =>
                        setBeforeStep(
                          event.target.value === "before"
                            ? { id: selectedId, path: validPath }
                            : undefined,
                        )
                      }
                    >
                      <option value="default">
                        {split
                          ? "After the paired join"
                          : !node || node.kind === "finish"
                            ? "Before Finish"
                            : "After selected step"}
                      </option>
                      <option value="before" disabled={!canInsertBefore}>
                        Before selected step
                      </option>
                    </select>
                  </label>
                  {!canInsert && (
                    <p className="field-hint">
                      Finish has multiple incoming connections. Keep one to insert here.
                    </p>
                  )}
                  <div className="node-library">
                    {(
                      [
                        "model",
                        "workspace",
                        "code",
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
                          !canInsert ||
                          graph.nodes.length + (kind === "route" || kind === "fork" ? 4 : 1) >
                            128 ||
                          ((kind === "subgraph" || kind === "loop") &&
                            (workflow.subgraphs?.length ?? 0) >= 32)
                        }
                        onClick={() => {
                          const added = addTemplate(workflow, scope, kind, selectedId, placement);
                          onChange(added.workflow);
                          stepToFocus.current = added.selected;
                          selectNode(added.selected);
                        }}
                      >
                        <Plus size={14} aria-hidden="true" />
                        <span>
                          Add{" "}
                          {kind === "model"
                            ? "model prompt"
                            : kind === "workspace"
                              ? "research workspace"
                              : nodeKinds[kind].label.toLowerCase()}
                        </span>
                      </Button>
                    ))}
                  </div>
                </div>
              }
            >
              <WorkflowOutline
                workflow={workflow}
                graph={graph}
                path={validPath}
                selected={selectedId}
                onSelect={(id) => {
                  selectNode(id);
                  document.getElementById(`workflow-node-${id}`)?.focus({ preventScroll: true });
                }}
                onOpen={openStep}
              />
            </WorkflowStepSearch>
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
            <details className="workflow-settings" id="workflow-execution-limits">
              <summary>Execution limits</summary>
              <ExecutionLimitFields
                budgets={workflow.budgets}
                onChange={(budgets, group) =>
                  onChange(
                    {
                      ...workflow,
                      schema_version: workflow.schema_version === "0.3" ? "0.3" : "0.2",
                      budgets,
                    },
                    group,
                  )
                }
              />
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
              {workflow.research && (
                <div className="canvas-model-picker">
                  <ModelPicker
                    label="Workflow model"
                    catalog={catalog}
                    value={workflow.research.model}
                    disabled={disabled}
                    onChange={(model) =>
                      onChange({ ...workflow, research: { ...workflow.research!, model } })
                    }
                  />
                </div>
              )}
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
            {workflow.research && (
              <WorkflowModelPlan workflow={workflow} catalog={catalog} onSelect={openStep} />
            )}
            <WorkflowReviewPlan workflow={workflow} onSelect={openStep} />
            <WorkflowCanvas
              key={scopeKey(scope)}
              workflow={graph}
              definitions={workflow.subgraphs}
              selected={selectedId}
              connectionView={connectionView}
              onConnectionViewChange={changeConnectionView}
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
          </div>
        }
        inspector={
          <fieldset
            id="node-inspector"
            ref={inspector}
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
                {node.kind !== "code" && (
                  <WorkflowStepText
                    key={`${scopeKey(scope)}/${node.id}/${node.kind}`}
                    name={node.label || node.id}
                    label={node.kind === "review" ? "Review question" : "Instructions"}
                    value={node.instructions}
                    placeholder={node.kind === "review" ? defaultReviewQuestion : undefined}
                    disabled={disabled}
                    onChange={(value) => editNode({ instructions: value }, "instructions")}
                    onApply={(value) => editNode({ instructions: value })}
                  />
                )}
                {node.kind === "review" ? (
                  <ReviewHandoff
                    graph={graph}
                    reviewId={node.id}
                    onOpenField={(stepId, field) => openStep(stepId, validPath, field)}
                  />
                ) : (
                  <StepOutputBindings
                    graph={graph}
                    step={node}
                    onOpenField={(stepId, field) => openStep(stepId, validPath, field)}
                  />
                )}
                <StepBranchPaths
                  graph={graph}
                  step={node}
                  onOpenStep={(stepId) => openStep(stepId, validPath)}
                />
                {node.kind === "note" && (
                  <p className="field-hint">
                    Notes copy text; they do not call a model. Use Add model prompt for AI
                    instructions.
                  </p>
                )}
                {node.config?.type === "research" && workflow.research && (
                  <>
                    <ModelPicker
                      label="Step model"
                      catalog={catalog}
                      inherited={workflow.research.model}
                      value={node.config.model ?? ""}
                      onChange={(model) =>
                        node.config?.type === "research" &&
                        editNode({ config: { ...node.config, model: model || undefined } })
                      }
                    />
                    {!catalog.loading && !catalog.status?.models?.length && (
                      <p className="field-hint">
                        Open Run workflow to connect or refresh your ChatGPT account.
                      </p>
                    )}
                  </>
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
                  onOpenSource={(stepId) => openStep(stepId, validPath)}
                  onOpenLoopSource={
                    loopSourcePath ? (stepId) => openStep(stepId, loopSourcePath) : undefined
                  }
                  onEditRunLimits={() => {
                    setLibraryOpen(true);
                    requestAnimationFrame(() => {
                      for (const id of ["workflow-execution-limits", "workflow-research-limits"]) {
                        const section = document.getElementById(id);
                        if (section instanceof HTMLDetailsElement) section.open = true;
                      }
                      document
                        .querySelector<HTMLInputElement>(
                          "#workflow-execution-limits input[name=max_active_seconds]",
                        )
                        ?.focus();
                    });
                  }}
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
                {(node.kind === "research" || node.kind === "review") && (
                  <Button
                    className="button"
                    disabled={disabled || graph.nodes.length >= 128 || graph.edges.length >= 256}
                    onClick={() => {
                      const duplicate = duplicateStep(graph, node);
                      changeGraph(
                        duplicate.graph,
                        undefined,
                        duplicate.graph.nodes.length > 32 || duplicate.graph.edges.length > 31,
                      );
                      stepToFocus.current = duplicate.id;
                      selectNode(duplicate.id);
                    }}
                  >
                    <Copy size={14} aria-hidden="true" />
                    {node.kind === "review" ? "Duplicate review" : "Duplicate research step"}
                  </Button>
                )}
                {nestedCopy && (
                  <>
                    <Button
                      className="button"
                      disabled={disabled || typeof nestedCopy === "string"}
                      onClick={() => {
                        if (typeof nestedCopy === "string") return;
                        const duplicate = nestedCopy();
                        onChange(duplicate.workflow);
                        stepToFocus.current = duplicate.id;
                        selectNode(duplicate.id);
                      }}
                    >
                      <Copy size={14} aria-hidden="true" />
                      {node.kind === "loop" ? "Duplicate loop" : "Duplicate subgraph"}
                    </Button>
                    {typeof nestedCopy === "string" && <p className="field-hint">{nestedCopy}</p>}
                  </>
                )}
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
