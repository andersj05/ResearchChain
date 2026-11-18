import type { Graph, ValidationIssue, Workflow, WorkflowNode } from "./workflow";
import { portsFor, reachableWorkflowGraphs, type GraphCrumb } from "./workflow-editing";

const validationSettings = {
  condition: "Open condition",
  join: "Open join setting",
  until: "Open stop condition",
} as const;

function stepAt(graph: Graph, segment: string | number | undefined) {
  if (typeof segment !== "number" || !Number.isInteger(segment)) return;
  const node = graph.nodes[segment];
  return node && graph.nodes.filter((candidate) => candidate.id === node.id).length === 1
    ? node
    : undefined;
}

function destination(
  step: WorkflowNode,
  path: GraphCrumb[],
  [field, port]: ValidationIssue["location"],
) {
  const input =
    field === "inputs" &&
    typeof port === "string" &&
    (step.kind === "note" || step.config?.type === step.kind) &&
    portsFor(step).some(
      (candidate) =>
        candidate.name === port && candidate.direction === "input" && candidate.type !== "control",
    )
      ? port
      : undefined;
  const config = step.config?.type;
  const setting =
    field === "config" &&
    ((port === "condition" && config === "route") ||
      (port === "join" && (config === "route" || config === "fork")) ||
      (port === "until" && step.config?.type === "loop" && step.config.until))
      ? { control: port, action: validationSettings[port] }
      : undefined;
  return { step, path, input, setting };
}

export function workflowStepAtValidationLocation(
  workflow: Workflow,
  location: ValidationIssue["location"],
) {
  if (location[0] !== "body") return;
  const document = location.slice(location[1] === "workflow" ? 2 : 1);
  if (document[0] === "nodes") {
    const step = stepAt(workflow, document[1]);
    return step && destination(step, [], document.slice(2));
  }
  if (document[0] !== "subgraphs" || typeof document[1] !== "number" || document[2] !== "nodes")
    return;
  const definition = workflow.subgraphs?.[document[1]];
  if (!definition) return;
  const step = stepAt(definition, document[3]);
  if (!step) return;
  for (const { graph, path } of reachableWorkflowGraphs(workflow)) {
    if (graph === definition) return destination(step, path, document.slice(4));
  }
}
