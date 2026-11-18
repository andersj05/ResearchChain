"use client";

import { Button } from "@ui-sdk/react/button";
import { researchDefaults } from "@/lib/workflow";
import type { Graph, Predicate, ValueSource, Workflow, WorkflowNode } from "@/lib/workflow";
import {
  addBranch,
  bindInput,
  forkDefinition,
  graphAt,
  portsFor,
  referenceOf,
  removeBranch,
  renameBranch,
  scopeKey,
  type GraphScope,
} from "@/lib/workflow-editing";

type SourceChoice = { value: string; label: string; type: "text" | "number"; source: ValueSource };
function sources(graph: Graph, exclude?: string): SourceChoice[] {
  return [
    { value: "brief", label: "Research brief", type: "text", source: { source: "brief" } },
    {
      value: "artifact_count",
      label: "Artifact count",
      type: "number",
      source: { source: "artifact_count" },
    },
    {
      value: "iteration",
      label: "Current iteration",
      type: "number",
      source: { source: "iteration" },
    },
    ...graph.nodes
      .filter((node) => node.id !== exclude)
      .flatMap((node) =>
        portsFor(node).flatMap((port): SourceChoice[] =>
          port.direction === "output" && port.type !== "control"
            ? [
                {
                  value: `${node.id}:${port.name}`,
                  label: `${node.label} · ${port.name}`,
                  type: port.type,
                  source: { source: "output", node_id: node.id, port: port.name },
                },
              ]
            : [],
        ),
      ),
  ];
}
function sourceKey(source?: ValueSource) {
  return source?.source === "output" ? `${source.node_id}:${source.port}` : (source?.source ?? "");
}

export function PredicateFields({
  graph,
  predicate,
  exclude,
  label,
  onChange,
}: {
  graph: Graph;
  predicate: Predicate;
  exclude?: string;
  label: string;
  onChange: (predicate: Predicate, field: string) => void;
}) {
  const options = sources(graph, exclude);
  const current = options.find((item) => item.value === sourceKey(predicate.left));
  const numeric = current?.type === "number";
  const operators = numeric
    ? [
        ["equals", "Equals"],
        ["not_equals", "Does not equal"],
        ["gt", "Greater than"],
        ["gte", "At least"],
        ["lt", "Less than"],
        ["lte", "At most"],
      ]
    : [
        ["equals", "Equals"],
        ["not_equals", "Does not equal"],
        ["contains", "Contains"],
      ];
  return (
    <fieldset className="config-fields" aria-label={label}>
      <legend>{label}</legend>
      <label>
        Value source
        <select
          aria-label={`${label} value source`}
          value={sourceKey(predicate.left)}
          onChange={(event) => {
            const choice = options.find((item) => item.value === event.target.value);
            if (choice)
              onChange(
                {
                  left: choice.source,
                  operator: choice.type === "text" ? "contains" : "gte",
                  value: choice.type === "text" ? "" : 1,
                },
                "source",
              );
          }}
        >
          {!current && (
            <option value={sourceKey(predicate.left)}>
              Missing source ({sourceKey(predicate.left)})
            </option>
          )}
          {options.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Comparison
        <select
          aria-label={`${label} comparison`}
          value={predicate.operator}
          onChange={(event) =>
            onChange(
              { ...predicate, operator: event.target.value as Predicate["operator"] },
              "operator",
            )
          }
        >
          {operators.map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      </label>
      <label>
        Compare with
        <input
          aria-label={`${label} compare with`}
          type={numeric ? "number" : "text"}
          value={predicate.value}
          onChange={(event) =>
            onChange(
              {
                ...predicate,
                value: numeric ? event.target.valueAsNumber || 0 : event.target.value,
              },
              "value",
            )
          }
        />
      </label>
    </fieldset>
  );
}

export function NodeConfiguration({
  workflow,
  graph,
  node,
  scope,
  onGraph,
  onWorkflow,
  onEdit,
  onOpen,
  onEditRunLimits,
}: {
  workflow: Workflow;
  graph: Graph;
  node: WorkflowNode;
  scope: GraphScope;
  onGraph: (graph: Graph, group?: string) => void;
  onWorkflow: (workflow: Workflow) => void;
  onEdit: (patch: Partial<WorkflowNode>, group?: string) => void;
  onOpen: (node: WorkflowNode) => void;
  onEditRunLimits: () => void;
}) {
  const config = node.config;
  const analyst = config?.type === "research" ? config.analyst : undefined;
  const ref = referenceOf(node);
  const body = ref ? graphAt(workflow, ref) : undefined;
  const definitions = workflow.subgraphs ?? [];
  const textOptions = sources(graph, node.id).filter((source) => source.type === "text");
  return (
    <>
      {config?.type === "code" && (
        <fieldset className="config-fields">
          <legend>JavaScript code</legend>
          <p className="field-hint">
            Write a function body using inputs.text, inputs.number, inputs.brief,
            inputs.artifact_count and inputs.iteration. Return text (up to 24,000 characters) and a
            finite number. This step makes no model calls.
          </p>
          <label>
            Code
            <textarea
              className="code-editor"
              spellCheck={false}
              rows={12}
              maxLength={20000}
              value={config.source}
              onChange={(event) =>
                onEdit({ config: { ...config, source: event.target.value } }, "code-source")
              }
            />
          </label>
          {(["text", "number"] as const).map((port) => {
            const choices = sources(graph, node.id).filter((item) => item.type === port);
            return (
              <label key={port}>
                {port === "text" ? "Code text input" : "Code number input"}
                <select
                  name={port}
                  value={sourceKey(node.inputs?.[port])}
                  onChange={(event) =>
                    onGraph(
                      bindInput(
                        graph,
                        node.id,
                        port,
                        choices.find((item) => item.value === event.target.value)?.source,
                      ),
                    )
                  }
                >
                  <option value="">{port === "text" ? "Empty text" : "Zero"}</option>
                  {node.inputs?.[port] &&
                    !choices.some((item) => item.value === sourceKey(node.inputs?.[port])) && (
                      <option value={sourceKey(node.inputs[port])}>Missing source</option>
                    )}
                  {choices.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          <label>
            Code time limit (seconds)
            <input
              type="number"
              min={0.05}
              max={5}
              step={0.05}
              value={config.timeout_seconds ?? 1}
              onChange={(event) =>
                onEdit(
                  { config: { ...config, timeout_seconds: event.target.valueAsNumber || 1 } },
                  "code-timeout",
                )
              }
            />
          </label>
          <p className="field-hint">
            Synchronous JavaScript and standard Math/JSON utilities, with 32 MB of memory. No
            network, files, Node.js modules, packages or credentials. Connect its text to a model or
            note step, or its number to a condition. Inputs and outputs are saved in Runs.
          </p>
        </fieldset>
      )}
      {config?.type === "research" && (
        <>
          <label>
            Step behavior
            <select
              value={config.stage ?? "hypothesize"}
              onChange={(event) =>
                onEdit({
                  config: {
                    ...config,
                    stage: event.target.value as typeof config.stage,
                    web_search: event.target.value === "custom" && config.web_search,
                    sec_financials: event.target.value === "custom" && config.sec_financials,
                    analyst: event.target.value === "custom" ? config.analyst : undefined,
                    prompt_version: event.target.value === "custom" ? "custom-1" : "research-1",
                  },
                })
              }
            >
              <option value="custom">Custom instructions</option>
              <option value="hypothesize">Form hypotheses</option>
              <option value="challenge">Challenge evidence</option>
              <option value="revise">Revise conclusions</option>
            </select>
          </label>
          {config.stage === "custom" && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(analyst)}
                  onChange={(event) =>
                    onEdit({
                      config: {
                        ...config,
                        analyst: event.target.checked
                          ? { max_passes: 4, skill: "", workspace: false }
                          : undefined,
                      },
                    })
                  }
                />
                Codex analyst
              </label>
              {analyst && (
                <>
                  <label>
                    <input
                      type="checkbox"
                      checked={analyst.workspace ?? false}
                      onChange={(event) =>
                        onEdit({
                          config: {
                            ...config,
                            analyst: {
                              ...analyst,
                              workspace: event.target.checked,
                              max_passes: Math.max(
                                event.target.checked ? 2 : 1,
                                analyst.max_passes ?? 4,
                              ),
                            },
                          },
                        })
                      }
                    />
                    Python workspace
                  </label>
                  {analyst.workspace && (
                    <p className="field-hint">
                      The analyst can write and run Python, inspect its output, revise the analysis,
                      and save files. Inspect its charts, scripts, data and reports in Runs.
                    </p>
                  )}
                  <label>
                    Analyst skill
                    <textarea
                      rows={6}
                      maxLength={32000}
                      placeholder="How should the analyst find evidence, test leads and decide when to finish?"
                      value={analyst.skill ?? ""}
                      onChange={(event) =>
                        onEdit(
                          {
                            config: {
                              ...config,
                              analyst: { ...analyst, skill: event.target.value },
                            },
                          },
                          "analyst-skill",
                        )
                      }
                    />
                  </label>
                  <label>
                    Maximum research passes
                    <input
                      type="number"
                      min={analyst.workspace ? 2 : 1}
                      max={100}
                      value={analyst.max_passes ?? 4}
                      onChange={(event) =>
                        onEdit(
                          {
                            config: {
                              ...config,
                              analyst: {
                                ...analyst,
                                max_passes: event.target.valueAsNumber || 1,
                              },
                            },
                          },
                          "analyst-passes",
                        )
                      }
                    />
                  </label>
                  <p className="field-hint">
                    Each pass uses one model request. The analyst can follow a lead using the tools
                    enabled below and finish as soon as it has enough evidence.
                  </p>
                  {analyst.workspace && (
                    <div>
                      <p className="field-hint">
                        This run allows {workflow.budgets?.max_active_seconds ?? 120} active
                        seconds,{" "}
                        {workflow.research?.limits?.max_response_seconds ??
                          researchDefaults.limits.max_response_seconds}{" "}
                        seconds per response and{" "}
                        {workflow.research?.limits?.max_model_calls ??
                          researchDefaults.limits.max_model_calls}{" "}
                        model attempts across all steps.
                      </p>
                      <Button className="button small" onClick={onEditRunLimits}>
                        Edit run limits
                      </Button>
                    </div>
                  )}
                </>
              )}
              <label>
                Web and market search
                <select
                  aria-label="Web and market search"
                  value={String(config.web_search ?? false)}
                  onChange={(event) =>
                    onEdit({
                      config: {
                        ...config,
                        web_search:
                          event.target.value === "auto" ? "auto" : event.target.value === "true",
                      },
                    })
                  }
                >
                  <option value="false">Off</option>
                  <option value="auto">Let the model decide</option>
                  <option value="true">Require a search</option>
                </select>
              </label>
              {config.web_search && (
                <p className="field-hint">
                  Queries can include your brief and evidence. Finance feeds depend on your
                  connected model.
                </p>
              )}
              <label>
                <input
                  type="checkbox"
                  aria-label="SEC financial statements"
                  checked={config.sec_financials ?? false}
                  onChange={(event) =>
                    onEdit({ config: { ...config, sec_financials: event.target.checked } })
                  }
                />
                SEC financial statements
              </label>
              {config.sec_financials && (
                <p className="field-hint">
                  The model can request annual filing data for one ticker. Set
                  RESEARCHCHAIN_SEC_USER_AGENT with a contact email on the worker for SEC access.
                </p>
              )}
            </>
          )}
          {(["context", "feedback"] as const).map((port) => (
            <label key={port}>
              {port === "context" ? "Context input" : "Reviewer feedback"}
              <select
                name={port}
                value={sourceKey(node.inputs?.[port])}
                onChange={(event) =>
                  onGraph(
                    bindInput(
                      graph,
                      node.id,
                      port,
                      textOptions.find((item) => item.value === event.target.value)?.source,
                    ),
                  )
                }
              >
                <option value="">None</option>
                {node.inputs?.[port] &&
                  !textOptions.some((item) => item.value === sourceKey(node.inputs?.[port])) && (
                    <option value={sourceKey(node.inputs[port])}>Missing source</option>
                  )}
                {textOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <p className="field-hint">
            {config.stage === "custom"
              ? "Your instructions define this task. The answer appears in the result's conclusion; hypotheses are optional. "
              : "Challenge and revise need a prior research result. "}
            Connect a human review&apos;s feedback to include it in this step.
          </p>
        </>
      )}
      {node.kind === "note" && (
        <label>
          Text input
          <select
            name="text"
            aria-label="Text input"
            aria-describedby="text-input-help"
            value={sourceKey(node.inputs?.text)}
            onChange={(event) =>
              onGraph(
                bindInput(
                  graph,
                  node.id,
                  "text",
                  textOptions.find((item) => item.value === event.target.value)?.source,
                ),
              )
            }
          >
            <option value="">Use instructions only</option>
            {node.inputs?.text &&
              !textOptions.some((item) => item.value === sourceKey(node.inputs?.text)) && (
                <option value={sourceKey(node.inputs.text)}>
                  Missing source ({sourceKey(node.inputs.text)})
                </option>
              )}
            {textOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <span id="text-input-help" className="field-hint">
            An output must be available on every path to this step.
          </span>
        </label>
      )}
      {config?.type === "route" && (
        <PredicateFields
          graph={graph}
          predicate={config.condition}
          exclude={node.id}
          label="Condition"
          onChange={(condition, field) =>
            onEdit({ config: { ...config, condition } }, `condition/${field}`)
          }
        />
      )}
      {(config?.type === "route" || config?.type === "fork") && (
        <label>
          Join step
          <select
            value={config.join}
            onChange={(event) => onEdit({ config: { ...config, join: event.target.value } })}
          >
            {graph.nodes
              .filter((item) => item.kind === "join")
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
          </select>
        </label>
      )}
      {config?.type === "fork" && (
        <fieldset className="config-fields">
          <legend>Parallel branches</legend>
          {config.branches.map((name, index) => (
            <div key={index} className="branch-setting">
              <label>
                Branch {index + 1} name
                <input
                  value={name}
                  maxLength={64}
                  onChange={(event) =>
                    onGraph(
                      renameBranch(graph, node.id, name, event.target.value),
                      `branch/${index}`,
                    )
                  }
                />
              </label>
              <Button
                className="button small"
                aria-label={`Remove branch ${index + 1} and its steps`}
                disabled={config.branches.length <= 2}
                onClick={() => onGraph(removeBranch(graph, node.id, name))}
              >
                Remove
              </Button>
            </div>
          ))}
          <p className="field-hint">
            Use lowercase letters, numbers, hyphens or underscores. Removing a branch removes its
            steps; Undo restores them.
          </p>
          <Button
            className="button small"
            disabled={config.branches.length >= 8 || graph.nodes.length >= 128}
            onClick={() => onGraph(addBranch(graph, node.id))}
          >
            Add branch
          </Button>
        </fieldset>
      )}
      {ref && config && "ref" in config && (
        <fieldset className="config-fields">
          <legend>Subgraph</legend>
          <label>
            Subgraph version
            <select
              value={scopeKey(ref)}
              onChange={(event) => {
                const definition = definitions.find(
                  (item) => scopeKey(item) === event.target.value,
                );
                if (definition)
                  onEdit({
                    config: { ...config, ref: { id: definition.id, version: definition.version } },
                  });
              }}
            >
              {!body && <option value={scopeKey(ref)}>Missing {scopeKey(ref)}</option>}
              {definitions
                .filter((item) => scopeKey(item) !== scopeKey(scope))
                .map((item) => (
                  <option key={scopeKey(item)} value={scopeKey(item)}>
                    {item.name} · v{item.version} ({item.id})
                  </option>
                ))}
            </select>
          </label>
          <div className="actions config-actions">
            <Button className="button small" disabled={!body} onClick={() => onOpen(node)}>
              Edit subgraph
            </Button>
            <Button
              className="button small"
              disabled={
                !body ||
                definitions.length >= 32 ||
                Math.max(
                  ...definitions.filter((item) => item.id === ref.id).map((item) => item.version),
                ) >= 100000
              }
              onClick={() => {
                const forked = forkDefinition(workflow, ref);
                const current = graphAt(forked.workflow, scope)!;
                const updated = {
                  ...current,
                  nodes: current.nodes.map((item) =>
                    item.id === node.id
                      ? { ...item, config: { ...config, ref: forked.ref } }
                      : item,
                  ),
                };
                onWorkflow(
                  scope
                    ? {
                        ...forked.workflow,
                        subgraphs: forked.workflow.subgraphs?.map((item) =>
                          scopeKey(item) === scopeKey(scope) ? { ...item, ...updated } : item,
                        ),
                      }
                    : { ...forked.workflow, nodes: updated.nodes },
                );
              }}
            >
              New version
            </Button>
          </div>
          <p className="field-hint">
            Each saved revision pins the complete definition bundle. Choose New version to edit a
            separate copy.
          </p>
        </fieldset>
      )}
      {config?.type === "loop" && (
        <>
          <label>
            Maximum iterations
            <input
              type="number"
              min={1}
              max={20}
              value={config.max_iterations}
              onChange={(event) =>
                onEdit(
                  { config: { ...config, max_iterations: event.target.valueAsNumber || 1 } },
                  "iterations",
                )
              }
            />
          </label>
          <label>
            Stop rule
            <select
              value={config.until ? "condition" : "fixed"}
              onChange={(event) =>
                onEdit({
                  config: {
                    ...config,
                    until:
                      event.target.value === "fixed"
                        ? null
                        : {
                            left: { source: "iteration" },
                            operator: "gte",
                            value: config.max_iterations,
                          },
                  },
                })
              }
            >
              <option value="fixed">Run the fixed number of iterations</option>
              <option value="condition">Stop when a condition is met</option>
            </select>
          </label>
          {config.until && body && (
            <PredicateFields
              graph={body}
              predicate={config.until}
              label="Stop condition"
              onChange={(until, field) =>
                onEdit({ config: { ...config, until } }, `until/${field}`)
              }
            />
          )}
          {config.until && (
            <p className="field-hint">
              Evaluated after each iteration. The run reaches its limit if the condition is still
              false at the maximum.
            </p>
          )}
        </>
      )}
    </>
  );
}
