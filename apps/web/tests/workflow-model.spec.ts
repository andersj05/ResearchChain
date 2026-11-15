import { expect, test } from "@playwright/test";
import {
  addTemplate,
  connectPorts,
  forkDefinition,
  graphAt,
  insertStep,
  portsFor,
  pruneDefinitions,
  referenceOf,
  removeStep,
  updateGraph,
} from "../src/lib/workflow-editing";
import { initialWorkflow, type Workflow, type NodeTypeSpec } from "../src/lib/workflow";

for (const kind of ["route", "fork", "loop", "subgraph"] as const) {
  test(`${kind} template and removal preserve the compiler contract`, async ({ request }) => {
    const before = structuredClone(initialWorkflow);
    const added = addTemplate(before, null, kind, "frame");
    expect(added.workflow.schema_version).toBe("0.2");
    const response = await request.post("/api/workflows/validate", { data: added.workflow });
    expect(response.status(), await response.text()).toBe(200);
    const graph = added.workflow;
    const split = graph.nodes.find((node) => node.id === added.selected)!;
    if (kind === "route" || kind === "fork") {
      const branch = graph.edges.find((edge) => edge.source === split.id)!;
      const branchNode = graph.nodes.find((node) => node.id === branch.target)!;
      const inserted = insertStep(
        graph,
        { ...branchNode, id: "inserted", label: "Inserted inside branch" },
        branch.target,
      );
      const repaired = removeStep(inserted, branch.target);
      expect(repaired.edges).toContainEqual({ ...branch, target: "inserted" });
      const valid = await request.post("/api/workflows/validate", { data: repaired });
      expect(valid.status(), await valid.text()).toBe(200);
    } else {
      expect(graph.subgraphs).toHaveLength(1);
      expect(graphAt(graph, referenceOf(split)!)).toBeDefined();
    }
    const removed = removeStep(graph, split.id);
    const valid = await request.post("/api/workflows/validate", { data: removed });
    expect(valid.status(), await valid.text()).toBe(200);
    expect(removed.nodes.map((node) => node.id)).toEqual(before.nodes.map((node) => node.id));
    expect(removed.edges.map(({ source, target }) => ({ source, target }))).toEqual(
      expect.arrayContaining(before.edges.map(({ source, target }) => ({ source, target }))),
    );
  });
}

test("nested editing and definition versions preserve the root and prior bundle", async ({
  request,
}) => {
  const first = addTemplate(structuredClone(initialWorkflow), null, "subgraph", "frame");
  const ref = referenceOf(first.workflow.nodes.find((node) => node.id === first.selected)!)!;
  const nested = addTemplate(first.workflow, ref, "loop", "step");
  expect(nested.workflow.nodes).toEqual(first.workflow.nodes);
  expect(nested.workflow.subgraphs).toHaveLength(2);
  const copied = forkDefinition(nested.workflow, ref);
  expect(copied.ref.version).toBe(2);
  const body = graphAt(copied.workflow, copied.ref)!;
  const edited = updateGraph(copied.workflow, copied.ref, { ...body, name: "New version" });
  expect(graphAt(edited, ref)?.name).toBe("New subgraph");
  expect(graphAt(nested.workflow, copied.ref)).toBeUndefined();
  const valid = await request.post("/api/workflows/validate", { data: edited });
  expect(valid.status(), await valid.text()).toBe(200);
});

test("typed canvas ports match the server registry and reject cross-type wiring", async ({
  request,
}) => {
  const response = await request.get("/api/node-types");
  expect(response.ok()).toBe(true);
  const registry: NodeTypeSpec[] = await response.json();
  for (const spec of registry) {
    const node = {
      ...initialWorkflow.nodes[0]!,
      kind: spec.kind,
      config:
        spec.kind === "fork"
          ? { type: "fork" as const, join: "join", branches: ["a", "b"] }
          : spec.kind === "route"
            ? {
                type: "route" as const,
                join: "join",
                condition: {
                  left: { source: "brief" as const },
                  operator: "contains" as const,
                  value: "test",
                },
              }
            : null,
    };
    const ports = portsFor(node);
    for (const direction of ["input", "output"] as const) {
      const expected = (direction === "input" ? spec.inputs : spec.outputs).flatMap((port) =>
        port.name === "<branch name>"
          ? [
              { ...port, name: "a" },
              { ...port, name: "b" },
            ]
          : [port],
      );
      expect(
        ports
          .filter((port) => port.direction === direction)
          .map(({ name, type }) => ({ name, type })),
      ).toEqual(expected);
    }
  }
  const workflow: Workflow = { ...structuredClone(initialWorkflow), schema_version: "0.2" };
  const from = portsFor(workflow.nodes[0]!);
  const to = portsFor(workflow.nodes[1]!);
  expect(
    connectPorts(
      workflow,
      from.find((p) => p.name === "text" && p.direction === "output")!,
      to.find((p) => p.name === "in")!,
    ),
  ).toBe(workflow);
  const connected = connectPorts(
    workflow,
    from.find((p) => p.name === "text" && p.direction === "output")!,
    to.find((p) => p.name === "text" && p.direction === "input")!,
  );
  const valid = await request.post("/api/workflows/validate", {
    data: { ...workflow, ...connected },
  });
  expect(valid.status(), await valid.text()).toBe(200);
  expect(connected.edges).toBe(workflow.edges);
  expect(connected.nodes[1]?.inputs?.text).toEqual({
    source: "output",
    node_id: "frame",
    port: "text",
  });
});

test("deleting a miswired split preserves unrelated downstream work", () => {
  const added = addTemplate(structuredClone(initialWorkflow), null, "route", "frame");
  const invalid = {
    ...added.workflow,
    edges: added.workflow.edges.map((edge) =>
      edge.source === added.selected && edge.source_port === "true"
        ? { ...edge, target: "challenge" }
        : edge,
    ),
  };
  const removed = removeStep(invalid, added.selected);
  for (const id of ["frame", "challenge", "review", "finish"])
    expect(removed.nodes.some((node) => node.id === id)).toBe(true);
  expect(removed.nodes.some((node) => node.id === added.selected)).toBe(false);
});

test("unused versions can be pruned while retaining referenced nested definitions", async ({
  request,
}) => {
  const root = addTemplate(structuredClone(initialWorkflow), null, "subgraph", "frame");
  const ref = referenceOf(root.workflow.nodes.find((node) => node.id === root.selected)!)!;
  const nested = addTemplate(root.workflow, ref, "subgraph", "step");
  const forked = forkDefinition(nested.workflow, ref);
  expect(forked.workflow.subgraphs).toHaveLength(3);
  const pruned = pruneDefinitions(forked.workflow);
  expect(pruned.subgraphs).toHaveLength(2);
  expect(graphAt(pruned, forked.ref)).toBeUndefined();
  const valid = await request.post("/api/workflows/validate", { data: pruned });
  expect(valid.status(), await valid.text()).toBe(200);
});

test("reviewer feedback upgrades a draft and keeps old revisions unchanged", async ({
  request,
}) => {
  const original = structuredClone(initialWorkflow);
  const draft = addTemplate(original, null, "note", "review").workflow;
  const updated = updateGraph(draft, null, {
    ...draft,
    nodes: draft.nodes.map((node) =>
      node.id === draft.edges.find((edge) => edge.source === "review")?.target
        ? { ...node, inputs: { text: { source: "output", node_id: "review", port: "feedback" } } }
        : node,
    ),
  });
  expect(updated.schema_version).toBe("0.3");
  expect(original.schema_version).toBe("0.1");
  const response = await request.post("/api/workflows/validate", { data: updated });
  expect(response.status(), await response.text()).toBe(200);
});
