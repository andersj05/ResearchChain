import type { Graph, ValueSource } from "./workflow";
import { controlOutputs } from "./workflow-editing";

export const builtInSourceLabels: Record<Exclude<ValueSource["source"], "output">, string> = {
  brief: "Research brief",
  artifact_count: "Artifact count",
  iteration: "Current iteration",
};

export function availableOutputSteps(graph: Graph, stepId: string | undefined) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!stepId || !nodes.has(stepId) || nodes.size !== graph.nodes.length) return;

  const outgoing = new Map(graph.nodes.map((node) => [node.id, new Map<string, string>()]));
  for (const edge of graph.edges) {
    const targets = outgoing.get(edge.source);
    const port = edge.source_port ?? "next";
    if (
      !targets ||
      !nodes.has(edge.target) ||
      targets.has(port) ||
      (edge.target_port ?? "in") !== "in"
    )
      return;
    targets.set(port, edge.target);
  }

  const joins = new Set<string>();
  for (const node of graph.nodes) {
    const targets = outgoing.get(node.id)!;
    const ports = controlOutputs(node);
    if (targets.size !== ports.length || ports.some((port) => !targets.has(port))) return;
    const config = node.config;
    if (config && config.type !== node.kind) return;
    if (node.kind === "route" || node.kind === "fork") {
      if (
        config?.type !== node.kind ||
        ports.length < 2 ||
        new Set(targets.values()).size !== ports.length ||
        nodes.get(config.join)?.kind !== "join" ||
        joins.has(config.join)
      )
        return;
      joins.add(config.join);
    }
  }

  const before = new Map<string, ReadonlySet<string>>();

  // Follow complete, disjoint branch regions so draft joins are used only when their wiring is clear.
  function walk(
    current: string,
    stop: string | undefined,
    prior: ReadonlySet<string>,
  ): ReadonlySet<string> | undefined {
    while (current !== stop) {
      const node = nodes.get(current);
      if (!node || node.kind === "join" || before.has(current)) return;
      before.set(current, prior);
      const after = new Set([...prior, current]);
      if (node.kind === "finish") return stop === undefined ? after : undefined;

      const config = node.config;
      if (config?.type === "route" || config?.type === "fork") {
        const join = config.join;
        if (join === stop || before.has(join)) return;
        const branches: ReadonlySet<string>[] = [];
        for (const target of outgoing.get(current)!.values()) {
          if (target === join) return;
          const branch = walk(target, join, after);
          if (!branch) return;
          branches.push(branch);
        }
        if (before.has(join)) return;
        // A fork runs every branch. A route runs just one, so only their common outputs are guaranteed.
        const atJoin = new Set(
          config.type === "fork"
            ? branches.flatMap((branch) => [...branch])
            : [...branches[0]!].filter((id) => branches.every((branch) => branch.has(id))),
        );
        before.set(join, atJoin);
        prior = new Set([...atJoin, join]);
        current = outgoing.get(join)!.get("next")!;
      } else {
        prior = after;
        current = outgoing.get(current)!.get("next")!;
      }
    }
    return prior;
  }

  if (walk(graph.start_node, undefined, new Set()) && before.size === nodes.size)
    return before.get(stepId);
}
