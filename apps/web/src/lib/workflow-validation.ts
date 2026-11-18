import type { Graph, ValidationIssue, Workflow } from "./workflow";
import { reachableWorkflowGraphs } from "./workflow-editing";

function stepAt(graph: Graph, segment: string | number | undefined) {
  if (typeof segment !== "number" || !Number.isInteger(segment)) return;
  const node = graph.nodes[segment];
  return node && graph.nodes.filter((candidate) => candidate.id === node.id).length === 1
    ? node
    : undefined;
}

export function workflowStepAtValidationLocation(
  workflow: Workflow,
  location: ValidationIssue["location"],
) {
  if (location[0] !== "body") return;
  const document = location.slice(location[1] === "workflow" ? 2 : 1);
  if (document[0] === "nodes") {
    const step = stepAt(workflow, document[1]);
    return step && { step, path: [] };
  }
  if (document[0] !== "subgraphs" || typeof document[1] !== "number" || document[2] !== "nodes")
    return;
  const definition = workflow.subgraphs?.[document[1]];
  if (!definition) return;
  const step = stepAt(definition, document[3]);
  if (!step) return;
  for (const { graph, path } of reachableWorkflowGraphs(workflow)) {
    if (graph === definition) return { step, path };
  }
}
