import { researchDefaults } from "./workflow";
import type {
  Graph,
  SubgraphRef,
  SubgraphDefinition,
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  ValueSource,
} from "./workflow";

export type GraphScope = SubgraphRef | null;
export type TemplateKind =
  "note" | "review" | "route" | "fork" | "loop" | "subgraph" | "research" | "model" | "code";
export type Port = {
  key: string;
  node: string;
  name: string;
  direction: "input" | "output";
  type: "control" | "text" | "number";
};
export type Connection = { from: string; to: string; type: Port["type"] };

export function scopeKey(scope: GraphScope) {
  return scope ? `${scope.id}@${scope.version}` : "root";
}

export function graphAt(workflow: Workflow, scope: GraphScope): Graph | undefined {
  return scope
    ? workflow.subgraphs?.find((item) => item.id === scope.id && item.version === scope.version)
    : workflow;
}

export function updateGraph(workflow: Workflow, scope: GraphScope, graph: Graph): Workflow {
  const patch = {
    name: graph.name,
    start_node: graph.start_node,
    nodes: graph.nodes,
    edges: graph.edges,
  };
  const usesFeedback = graph.nodes.some((node) => {
    const sources = Object.values(node.inputs ?? {});
    if (node.config?.type === "route") sources.push(node.config.condition.left);
    if (node.config?.type === "loop" && node.config.until) sources.push(node.config.until.left);
    return sources.some((source) => source.port === "feedback");
  });
  const version = usesFeedback ? "0.3" : workflow.schema_version;
  if (!scope) return { ...workflow, ...patch, schema_version: version };
  return {
    ...workflow,
    schema_version: version === "0.3" ? "0.3" : "0.2",
    subgraphs: workflow.subgraphs?.map((item) =>
      item.id === scope.id && item.version === scope.version ? { ...item, ...patch } : item,
    ),
  };
}

export function referenceOf(node: WorkflowNode): SubgraphRef | undefined {
  return node.config?.type === "subgraph" || node.config?.type === "loop"
    ? node.config.ref
    : undefined;
}

export function controlOutputs(node: WorkflowNode): string[] {
  if (node.kind === "finish") return [];
  if (node.config?.type === "route") return ["true", "false"];
  if (node.config?.type === "fork") return node.config.branches;
  return ["next"];
}

export function portKey(node: string, direction: Port["direction"], name: string) {
  return `${node}:${direction}:${name}`;
}

// Mirrors the public registry; the registry parity test guards contract changes.
export function portsFor(node: WorkflowNode): Port[] {
  const port = (direction: Port["direction"], name: string, type: Port["type"]): Port => ({
    key: portKey(node.id, direction, name),
    node: node.id,
    direction,
    name,
    type,
  });
  return [
    port("input", "in", "control"),
    ...(node.kind === "note" ? [port("input", "text", "text")] : []),
    ...controlOutputs(node).map((name) => port("output", name, "control")),
    ...(node.kind === "note" || node.kind === "research" ? [port("output", "text", "text")] : []),
    ...(node.kind === "research"
      ? [port("input", "context", "text"), port("input", "feedback", "text")]
      : []),
    ...(node.kind === "code"
      ? [
          port("input", "text", "text"),
          port("input", "number", "number"),
          port("output", "text", "text"),
          port("output", "number", "number"),
        ]
      : []),
    ...(node.kind === "review"
      ? [port("output", "decision", "text"), port("output", "feedback", "text")]
      : []),
    ...(node.kind === "loop" ? [port("output", "iterations", "number")] : []),
  ];
}

export function compatiblePorts(a?: Port, b?: Port): boolean {
  return !!a && !!b && a.node !== b.node && a.direction !== b.direction && a.type === b.type;
}

export function connectionsFor(graph: Graph): Connection[] {
  return [
    ...graph.edges.map((edge) => ({
      from: portKey(edge.source, "output", edge.source_port ?? "next"),
      to: portKey(edge.target, "input", edge.target_port ?? "in"),
      type: "control" as const,
    })),
    ...graph.nodes.flatMap((node) =>
      Object.entries(node.inputs ?? {}).flatMap(([name, value]) =>
        value.source === "output" && value.node_id && value.port
          ? [
              {
                from: portKey(value.node_id, "output", value.port),
                to: portKey(node.id, "input", name),
                type:
                  portsFor(node).find((port) => port.direction === "input" && port.name === name)
                    ?.type ?? "text",
              },
            ]
          : [],
      ),
    ),
  ];
}

export function connectPorts(graph: Graph, a: Port, b: Port): Graph {
  if (!compatiblePorts(a, b)) return graph;
  const [from, to] = a.direction === "output" ? [a, b] : [b, a];
  if (from.type === "control") {
    return {
      ...graph,
      edges: [
        ...graph.edges.filter(
          (edge) => edge.source !== from.node || (edge.source_port ?? "next") !== from.name,
        ),
        { source: from.node, source_port: from.name, target: to.node, target_port: to.name },
      ],
    };
  }
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id !== to.node
        ? node
        : {
            ...node,
            inputs: {
              ...node.inputs,
              [to.name]: { source: "output", node_id: from.node, port: from.name },
            },
          },
    ),
  };
}

export function bindInput(graph: Graph, id: string, name: string, source?: ValueSource): Graph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.id !== id) return node;
      const inputs = { ...node.inputs };
      if (source) inputs[name] = source;
      else delete inputs[name];
      return { ...node, inputs };
    }),
  };
}

const edge = (source: string, target: string, source_port = "next"): WorkflowEdge => ({
  source,
  target,
  source_port,
  target_port: "in",
});
const makeId = (kind: string) => `${kind}-${crypto.randomUUID().slice(0, 8)}`;
const makeNode = (
  id: string,
  kind: WorkflowNode["kind"],
  label: string,
  x = 60,
  y = 60,
): WorkflowNode => ({
  id,
  kind,
  label,
  instructions: "",
  position: { x: Math.min(x, 9700), y: Math.min(y, 9700) },
});

function insertionAnchor(graph: Graph, selected: string) {
  const candidate = graph.nodes.find((node) => node.id === selected);
  if (candidate?.config?.type === "route" || candidate?.config?.type === "fork") {
    const join = candidate.config.join;
    return graph.nodes.find((node) => node.id === join);
  }
  return candidate ?? graph.nodes.find((node) => node.kind === "finish");
}

function insertFragment<G extends Graph>(
  graph: G,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  entry: string,
  exit: string,
  selected: string,
): G {
  const anchor = insertionAnchor(graph, selected);
  if (!anchor)
    return { ...graph, nodes: [...graph.nodes, ...nodes], edges: [...graph.edges, ...edges] };
  const before = anchor.kind === "finish";
  const adjacent = graph.edges.filter((item) =>
    before ? item.target === anchor.id : item.source === anchor.id,
  );
  const remaining = graph.edges.filter((item) => !adjacent.includes(item));
  if (before) {
    remaining.push(...adjacent.map((item) => ({ ...item, target: entry })), edge(exit, anchor.id));
  } else {
    remaining.push(edge(anchor.id, entry), ...adjacent.map((item) => ({ ...item, source: exit })));
  }
  const index = graph.nodes.indexOf(anchor) + (before ? 0 : 1);
  return {
    ...graph,
    nodes: [...graph.nodes.slice(0, index), ...nodes, ...graph.nodes.slice(index)],
    edges: [...remaining, ...edges],
    start_node: before && graph.start_node === anchor.id ? entry : graph.start_node,
  };
}

export function insertStep<G extends Graph>(graph: G, step: WorkflowNode, selected: string): G {
  const anchor = insertionAnchor(graph, selected);
  const nextId =
    anchor?.kind === "finish"
      ? anchor.id
      : graph.edges.find((item) => item.source === anchor?.id)?.target;
  const finish = graph.nodes.find((node) => node.id === nextId && node.kind === "finish");
  const positioned = {
    ...step,
    position: finish
      ? { ...finish.position }
      : {
          x: anchor?.position.x ?? 60,
          y: Math.min(9700, Math.max(0, ...graph.nodes.map((node) => node.position.y)) + 260),
        },
  };
  const layout = finish
    ? {
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.id === finish.id
            ? { ...node, position: { ...node.position, y: Math.min(10000, node.position.y + 260) } }
            : node,
        ),
      }
    : graph;
  return insertFragment(layout, [positioned], [], step.id, step.id, selected);
}

export function addTemplate(
  workflow: Workflow,
  scope: GraphScope,
  kind: TemplateKind,
  selected: string,
): { workflow: Workflow; selected: string } {
  const graph = graphAt(workflow, scope);
  if (!graph) return { workflow, selected };
  const id = makeId(kind);
  const anchor = insertionAnchor(graph, selected);
  const x = Math.min(anchor?.position.x ?? 60, 8800);
  const y = Math.min(Math.max(0, ...graph.nodes.map((node) => node.position.y)) + 180, 9400);
  let next =
    workflow.schema_version === "0.1" && graph.nodes.length >= 32
      ? { ...workflow, schema_version: "0.2" as const }
      : workflow;
  if (kind === "code") {
    const step: WorkflowNode = {
      ...makeNode(id, "code", "Custom code"),
      config: {
        type: "code",
        language: "javascript",
        runtime: "quickjs-ng-0.18.0.1",
        source: "return { text: inputs.text, number: inputs.number };",
        timeout_seconds: 1,
      },
      inputs: { text: { source: "brief" } },
    };
    next = { ...next, schema_version: next.schema_version === "0.3" ? "0.3" : "0.2" };
    return { workflow: updateGraph(next, scope, insertStep(graph, step, selected)), selected: id };
  }
  if (kind === "research" || kind === "model") {
    const step = {
      ...makeNode(id, "research", kind === "model" ? "Model prompt" : "Form hypotheses"),
      config: {
        type: "research" as const,
        stage: kind === "model" ? ("custom" as const) : ("hypothesize" as const),
        prompt_version: kind === "model" ? ("custom-1" as const) : ("research-1" as const),
        web_search: false,
        sec_financials: false,
      },
    };
    next = {
      ...next,
      schema_version: "0.3",
      research: next.research ?? structuredClone(researchDefaults),
    };
    return { workflow: updateGraph(next, scope, insertStep(graph, step, selected)), selected: id };
  }
  if (kind === "note" || kind === "review") {
    return {
      workflow: updateGraph(
        next,
        scope,
        insertStep(
          graph,
          makeNode(id, kind, kind === "note" ? "New research note" : "New human review"),
          selected,
        ),
      ),
      selected: id,
    };
  }
  next = { ...next, schema_version: next.schema_version === "0.3" ? "0.3" : "0.2" };
  if (kind === "route" || kind === "fork") {
    const join = makeNode(makeId("join"), "join", "Join branches", x + 660, y);
    const names = kind === "route" ? ["true", "false"] : ["first", "second"];
    const branches = names.map((name, i) =>
      makeNode(
        makeId("note"),
        "note",
        `${name === "true" ? "If true" : name === "false" ? "If false" : `Branch ${i + 1}`}`,
        x + 330,
        y + i * 180,
      ),
    );
    const split: WorkflowNode = {
      ...makeNode(id, kind, kind === "route" ? "New condition" : "New parallel branches", x, y),
      config:
        kind === "route"
          ? {
              type: "route",
              condition: { left: { source: "artifact_count" }, operator: "gte", value: 1 },
              join: join.id,
            }
          : { type: "fork", branches: names, join: join.id },
    };
    const updated = insertFragment(
      graph,
      [split, ...branches, join],
      branches.flatMap((branch, i) => [edge(id, branch.id, names[i]), edge(branch.id, join.id)]),
      id,
      join.id,
      selected,
    );
    return { workflow: updateGraph(next, scope, updated), selected: id };
  }
  const definition: SubgraphDefinition = {
    id: makeId("body"),
    version: 1,
    name: kind === "loop" ? "Loop body" : "New subgraph",
    start_node: "step",
    nodes: [
      makeNode("step", "note", "Research step"),
      makeNode("finish", "finish", "Finish body", 390),
    ],
    edges: [edge("step", "finish")],
  };
  const ref = { id: definition.id, version: definition.version };
  const node: WorkflowNode = {
    ...makeNode(id, kind, kind === "loop" ? "New bounded loop" : "New subgraph", x, y),
    config:
      kind === "loop"
        ? { type: "loop", ref, max_iterations: 2, until: null }
        : { type: "subgraph", ref },
  };
  next.subgraphs = [...(next.subgraphs ?? []), definition];
  return {
    workflow: updateGraph(next, scope, insertFragment(graph, [node], [], id, id, selected)),
    selected: id,
  };
}

// In an incomplete draft a miswired branch may reach unrelated steps. Only
// remove a whole region when every path reaches its join and has no outside entry.
function branchRegion(
  graph: Graph,
  owner: string,
  entries: string[],
  join: string,
): Set<string> | null {
  if (graph.nodes.find((node) => node.id === join)?.kind !== "join") return null;
  const region = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): boolean => {
    if (id === join) return true;
    if (visiting.has(id)) return false;
    if (region.has(id)) return true;
    const node = graph.nodes.find((item) => item.id === id);
    if (!node || node.kind === "finish" || id === owner) return false;
    const next = graph.edges.filter((item) => item.source === id);
    if (!next.length) return false;
    visiting.add(id);
    if (!next.every((item) => visit(item.target))) return false;
    visiting.delete(id);
    region.add(id);
    return true;
  };
  if (!entries.length || !entries.every(visit)) return null;
  if (
    graph.edges.some(
      (item) => region.has(item.target) && !region.has(item.source) && item.source !== owner,
    )
  )
    return null;
  return region;
}

export function removeStep<G extends Graph>(graph: G, id: string): G {
  const node = graph.nodes.find((item) => item.id === id);
  const removed = new Set([id]);
  let exit = id;
  if (node?.config?.type === "fork" || node?.config?.type === "route") {
    const join = node.config.join;
    const region = branchRegion(
      graph,
      id,
      graph.edges.filter((item) => item.source === id).map((item) => item.target),
      join,
    );
    if (region && !graph.edges.some((item) => item.target === join && !region.has(item.source))) {
      exit = join;
      region.forEach((item) => removed.add(item));
      removed.add(join);
    }
  }
  const incoming = graph.edges.filter((item) => item.target === id && !removed.has(item.source));
  const outgoing = graph.edges.filter((item) => item.source === exit && !removed.has(item.target));
  const edges = graph.edges.filter(
    (item) => !removed.has(item.source) && !removed.has(item.target),
  );
  const successor = outgoing.length === 1 ? outgoing[0] : undefined;
  if (successor) {
    edges.push(
      ...incoming
        .filter((item) => item.source !== successor.target)
        .map((item) => ({
          ...item,
          target: successor.target,
          target_port: successor.target_port,
        })),
    );
  }
  return {
    ...graph,
    nodes: graph.nodes
      .filter((item) => !removed.has(item.id))
      .map((item) => ({
        ...item,
        inputs: Object.fromEntries(
          Object.entries(item.inputs ?? {}).filter(
            ([, source]) => source.source !== "output" || !removed.has(source.node_id ?? ""),
          ),
        ),
      })),
    edges,
    start_node: removed.has(graph.start_node)
      ? (outgoing[0]?.target ?? graph.nodes.find((item) => !removed.has(item.id))?.id ?? "")
      : graph.start_node,
  };
}

export function forkDefinition(
  workflow: Workflow,
  ref: SubgraphRef,
): { workflow: Workflow; ref: SubgraphRef } {
  const definition = workflow.subgraphs?.find(
    (item) => item.id === ref.id && item.version === ref.version,
  );
  if (!definition) return { workflow, ref };
  const version =
    Math.max(
      ...(workflow.subgraphs ?? [])
        .filter((item) => item.id === ref.id)
        .map((item) => item.version),
    ) + 1;
  return {
    workflow: {
      ...workflow,
      subgraphs: [...(workflow.subgraphs ?? []), { ...structuredClone(definition), version }],
    },
    ref: { id: ref.id, version },
  };
}

export function renameBranch(graph: Graph, id: string, before: string, after: string): Graph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === id && node.config?.type === "fork"
        ? {
            ...node,
            config: {
              ...node.config,
              branches: node.config.branches.map((name) => (name === before ? after : name)),
            },
          }
        : node,
    ),
    edges: graph.edges.map((item) =>
      item.source === id && item.source_port === before ? { ...item, source_port: after } : item,
    ),
  };
}

export function addBranch(graph: Graph, id: string): Graph {
  const node = graph.nodes.find((item) => item.id === id);
  if (node?.config?.type !== "fork" || node.config.branches.length >= 8) return graph;
  const config = node.config;
  let number = config.branches.length + 1;
  while (node.config.branches.includes(`branch-${number}`)) number++;
  const name = `branch-${number}`;
  const step = makeNode(
    makeId("note"),
    "note",
    `Branch ${number}`,
    node.position.x + 330,
    Math.max(...graph.nodes.map((item) => item.position.y)) + 180,
  );
  return {
    ...graph,
    nodes: [
      ...graph.nodes.map((item) =>
        item.id === id
          ? {
              ...node,
              config: { ...config, branches: [...config.branches, name] },
            }
          : item,
      ),
      step,
    ],
    edges: [...graph.edges, edge(id, step.id, name), edge(step.id, node.config.join)],
  };
}

export function removeBranch(graph: Graph, id: string, name: string): Graph {
  const node = graph.nodes.find((item) => item.id === id);
  if (node?.config?.type !== "fork" || node.config.branches.length <= 2) return graph;
  const removed =
    branchRegion(
      graph,
      id,
      graph.edges
        .filter((item) => item.source === id && item.source_port === name)
        .map((item) => item.target),
      node.config.join,
    ) ?? new Set<string>();
  return {
    ...graph,
    nodes: graph.nodes
      .filter((item) => !removed.has(item.id))
      .map((item) =>
        item.id === id && item.config?.type === "fork"
          ? {
              ...item,
              config: {
                ...item.config,
                branches: item.config.branches.filter((branch) => branch !== name),
              },
            }
          : item,
      ),
    edges: graph.edges.filter(
      (item) =>
        !removed.has(item.source) &&
        !removed.has(item.target) &&
        !(item.source === id && item.source_port === name),
    ),
  };
}

export function pruneDefinitions(workflow: Workflow): Workflow {
  const used = new Set<string>();
  const visit = (graph: Graph) =>
    graph.nodes.forEach((node) => {
      const ref = referenceOf(node);
      if (!ref || used.has(scopeKey(ref))) return;
      used.add(scopeKey(ref));
      const body = graphAt(workflow, ref);
      if (body) visit(body);
    });
  visit(workflow);
  return { ...workflow, subgraphs: workflow.subgraphs?.filter((body) => used.has(scopeKey(body))) };
}
