import type { Graph, WorkflowEdge, WorkflowNode } from "@/lib/workflow";
import { controlOutputs } from "@/lib/workflow-editing";

function splitConfig(node: WorkflowNode) {
  const { kind, config } = node;
  return (kind === "route" && config?.type === "route") ||
    (kind === "fork" && config?.type === "fork")
    ? config
    : undefined;
}

export function branchPaths(graph: Graph, split: WorkflowNode) {
  const config = splitConfig(split);
  if (!config) return;

  const nodes = new Map<string, WorkflowNode>();
  const duplicates = new Set<string>();
  const joinOwners = new Map<string, number>();
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const node of graph.nodes) {
    if (nodes.has(node.id)) duplicates.add(node.id);
    nodes.set(node.id, node);
    const pair = splitConfig(node)?.join;
    if (pair) joinOwners.set(pair, (joinOwners.get(pair) ?? 0) + 1);
  }
  for (const edge of graph.edges) {
    const edges = outgoing.get(edge.source) ?? [];
    edges.push(edge);
    outgoing.set(edge.source, edges);
  }

  function nodeAt(id: string) {
    return duplicates.has(id) ? undefined : nodes.get(id);
  }

  function portEdges(id: string, port: string) {
    return (outgoing.get(id) ?? []).filter((edge) => (edge.source_port ?? "next") === port);
  }

  function targetOf(edges: WorkflowEdge[]) {
    const [edge] = edges;
    if (edge && edges.length === 1 && (edge.target_port ?? "in") === "in") {
      return nodeAt(edge.target);
    }
  }

  function trace(first: WorkflowNode, stop: string, steps: Map<string, WorkflowNode>): boolean {
    let current: WorkflowNode | undefined = first;
    // Each traced node is visited once per branch. A paired inner join is only
    // visited after its own paths, so only it can reconverge those paths.
    while (current && current.id !== stop) {
      if (
        current.id === split.id ||
        steps.has(current.id) ||
        current.kind === "join" ||
        current.kind === "finish"
      ) {
        return false;
      }
      steps.set(current.id, current);
      const nested = splitConfig(current);
      if (nested) {
        const id = current.id;
        const join = nodeAt(nested.join);
        if (join?.kind !== "join" || joinOwners.get(join.id) !== 1 || steps.has(join.id)) {
          return false;
        }
        const ports = controlOutputs(current);
        const complete = ports.map((port) => {
          const target = targetOf(portEdges(id, port));
          return target !== undefined && target.id !== join.id && trace(target, join.id, steps);
        });
        if (ports.length < 2 || !complete.every(Boolean)) return false;
        steps.set(join.id, join);
        current = join;
      } else if (current.kind === "route" || current.kind === "fork") {
        return false;
      }
      current = targetOf(portEdges(current.id, "next"));
    }
    return current?.id === stop;
  }

  const joinNode = nodeAt(config.join);
  const join = joinNode?.kind === "join" ? joinNode : undefined;
  const names = controlOutputs(split);
  const branches = names.map((name) => {
    const edges = portEdges(split.id, name);
    const first = targetOf(edges);
    const steps = new Map<string, WorkflowNode>();
    let issue: string | undefined;
    if (!name) issue = "Give this branch a name.";
    else if (!edges.length) issue = "No next step connected.";
    else if (!first || names.indexOf(name) !== names.lastIndexOf(name) || first.id === split.id) {
      issue = "The first step is unresolved.";
    } else if (first.id === join?.id) {
      issue = "This branch connects directly to the join. Add a step before it.";
    } else if (!join || joinOwners.get(join.id) !== 1) {
      issue = "The paired join is unresolved.";
    } else if (!trace(first, join.id, steps)) {
      issue = "This path does not resolve to the paired join.";
    }
    return { name, first, steps, issue };
  });

  return {
    join,
    joinIssue: !join
      ? "Choose an existing join step."
      : joinOwners.get(join.id) !== 1
        ? "The selected join is shared by multiple splits."
        : undefined,
    branches: branches.map(({ name, first, steps, issue }) => ({
      name,
      first: first?.id === join?.id || first?.id === split.id ? undefined : first,
      steps: [...steps.values()].filter((step) => step.id !== first?.id),
      issue:
        issue ??
        (first && branches.some((branch) => branch.steps !== steps && branch.first?.id === first.id)
          ? "Branches share the first step."
          : graph.edges.some(
                (edge) =>
                  steps.has(edge.target) && edge.source !== split.id && !steps.has(edge.source),
              )
            ? "A step on this path has a connection from outside it."
            : undefined),
    })),
  };
}
