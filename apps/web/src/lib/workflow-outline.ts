import { branchPaths } from "@/lib/workflow-branch-paths";
import type { Graph, WorkflowEdge, WorkflowNode } from "@/lib/workflow";

export type OutlineStep = {
  node: WorkflowNode;
  branches?: { name: string; steps: OutlineStep[] }[];
  issue?: string;
};

export function workflowOutline(graph: Graph) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const edge of graph.edges) {
    const edges = outgoing.get(edge.source) ?? [];
    edges.push(edge);
    outgoing.set(edge.source, edges);
  }
  const visited = new Set<string>();

  function walk(first: string, stop?: string): OutlineStep[] {
    const steps: OutlineStep[] = [];
    let id = first;
    while (id !== stop) {
      const node = nodes.get(id);
      if (!node || visited.has(id)) break;
      visited.add(id);
      const step: OutlineStep = { node };
      steps.push(step);
      if (node.kind === "finish") break;

      if (node.kind === "route" || node.kind === "fork") {
        const paths = branchPaths(graph, node);
        if (
          !paths?.join ||
          paths.joinIssue ||
          visited.has(paths.join.id) ||
          paths.branches.length < 2 ||
          paths.branches.some(
            ({ first, steps, issue }) =>
              !first || issue || [first, ...steps].some((item) => visited.has(item.id)),
          )
        ) {
          step.issue = "Branch wiring needs attention";
          break;
        }
        const join = paths.join.id;
        step.branches = paths.branches.map(({ name, first }) => ({
          name: node.kind === "route" ? `If ${name}` : name,
          steps: walk(first!.id, join),
        }));
        id = join;
        continue;
      }

      const edges = outgoing.get(id);
      const next = edges?.[0];
      if (
        edges?.length !== 1 ||
        !next ||
        (next.source_port ?? "next") !== "next" ||
        (next.target_port ?? "in") !== "in" ||
        !nodes.has(next.target) ||
        visited.has(next.target)
      ) {
        step.issue = "Next step wiring needs attention";
        break;
      }
      id = next.target;
    }
    return steps;
  }

  const connected = walk(graph.start_node);
  const other = graph.nodes.filter((node) => !visited.has(node.id)).map((node) => ({ node }));
  return { connected, other };
}
