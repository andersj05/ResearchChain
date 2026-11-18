import { graphAt, referenceOf, scopeKey, type GraphCrumb } from "./workflow-editing";
import type { Graph, Workflow, WorkflowNode } from "./workflow";

type ResearchConfig = Extract<NonNullable<WorkflowNode["config"]>, { type: "research" }>;

export function researchToolLabels(config: ResearchConfig) {
  return [
    config.analyst ? `Codex analyst, up to ${config.analyst.max_passes ?? 4} passes` : "",
    config.analyst?.workspace ? "Python execution and saved files" : "",
    config.web_search === "auto"
      ? "optional web search"
      : config.web_search
        ? "required web search"
        : "",
    config.sec_financials ? "optional SEC lookup" : "",
  ].filter(Boolean);
}

function reachableNodes(graph: Graph) {
  const nodes = new Set(graph.nodes.map(({ id }) => id));
  if (!nodes.has(graph.start_node)) return [];
  const connections = new Map<string, string[]>();
  for (const { source, target } of graph.edges) {
    if (!nodes.has(target)) continue;
    const targets = connections.get(source) ?? [];
    targets.push(target);
    connections.set(source, targets);
  }
  const visited = new Set([graph.start_node]);
  for (const id of visited) {
    for (const target of connections.get(id) ?? []) visited.add(target);
  }
  return graph.nodes.filter(({ id }) => visited.has(id));
}

export function workflowModelPlan(workflow: Workflow) {
  const scopes: { graph: Graph; path: GraphCrumb[]; location: string }[] = [
    { graph: workflow, path: [], location: workflow.name || "Root workflow" },
  ];
  const visited = new Set<string>();
  const steps = [];
  for (const { graph, path, location } of scopes) {
    for (const node of reachableNodes(graph)) {
      if (node.config?.type === "research") {
        steps.push({
          id: node.id,
          label: node.label,
          path,
          location,
          model: node.config.model ?? workflow.research?.model,
          override: Boolean(node.config.model),
          tools: researchToolLabels(node.config),
        });
      }
      const ref = referenceOf(node);
      if (!ref || path.length >= 8 || visited.has(scopeKey(ref))) continue;
      const body = graphAt(workflow, ref);
      if (!body) continue;
      // Each pinned definition has one editable configuration. The first match
      // in breadth-first order gives a shortest reachable path to that editor.
      visited.add(scopeKey(ref));
      scopes.push({
        graph: body,
        path: [...path, { ref, via: node.id }],
        location: `${location} › ${node.label} · ${body.name} v${ref.version}`,
      });
    }
  }
  return steps;
}
