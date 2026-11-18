import { expect, test } from "./fixtures";
import type { Graph, Workflow, WorkflowNode } from "../src/lib/workflow";

function step(
  id: string,
  label: string,
  kind: WorkflowNode["kind"],
  config?: WorkflowNode["config"],
): WorkflowNode {
  return { id, label, kind, config, instructions: label, position: { x: 40, y: 80 } };
}

function chain(name: string, first: WorkflowNode, ...rest: WorkflowNode[]): Graph {
  const steps = [first, ...rest];
  return {
    name,
    start_node: first.id,
    nodes: [...steps, step("finish", "Finish", "finish")].map((node, index) => ({
      ...node,
      position: { x: 40 + index * 300, y: 80 },
    })),
    edges: steps.map((node, index) => ({
      source: node.id,
      target: steps[index + 1]?.id ?? "finish",
      source_port: "next",
      target_port: "in",
    })),
  };
}

test("find callers of the exact pinned definition and return to the step being edited", async ({
  page,
  request,
}) => {
  const shared = { id: "shared", version: 1 };
  const callers = { id: "callers", version: 1 };
  const wrapper = { id: "wrapper", version: 1 };
  const method = chain("Shared method", step("method", "Inspect the method", "note"));
  const workflow: Workflow = {
    schema_version: "0.2",
    ...chain(
      "Definition reference test",
      step("root_call", "Root call", "loop", { type: "loop", ref: shared, max_iterations: 2 }),
      step("indirect", "Indirect path", "subgraph", { type: "subgraph", ref: wrapper }),
      step("direct", "Direct path", "subgraph", { type: "subgraph", ref: callers }),
      step("other_version", "Other version", "subgraph", {
        type: "subgraph",
        ref: { ...shared, version: 2 },
      }),
    ),
    subgraphs: [
      { ...shared, ...method },
      { ...shared, ...method, version: 2 },
      {
        ...wrapper,
        ...chain(
          "Wrapper",
          step("inner", "Longer path to callers", "subgraph", { type: "subgraph", ref: callers }),
        ),
      },
      {
        ...callers,
        ...chain(
          "Nested callers",
          step("nested_call", "Nested call", "subgraph", { type: "subgraph", ref: shared }),
        ),
      },
      {
        id: "archive",
        version: 1,
        ...chain(
          "Unused callers",
          step("unused_call", "Unused call", "subgraph", { type: "subgraph", ref: shared }),
        ),
      },
    ],
  };
  const saved = await request.post("/api/revisions", { data: workflow });
  expect(saved.status()).toBe(201);
  const revision = await saved.json();
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(`/?revision=${revision.id}`);

  const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
  const breadcrumbs = page.getByRole("navigation", { name: "Graph breadcrumbs" });
  const disclosure = page.getByText("Used by 3 draft references", { exact: true });
  const references = page.getByRole("list", { name: "References to this definition version" });
  const back = page.getByRole("button", { name: "Return to step Inspect the method", exact: true });
  await expect(stepName).toHaveValue("Root call");
  await page.getByRole("button", { name: "Edit subgraph", exact: true }).click();
  await expect(stepName).toHaveValue("Inspect the method");
  await expect(references).toBeHidden();
  await disclosure.press("Enter");
  await expect(references.getByRole("listitem")).toHaveCount(3);
  const unused = references.getByRole("listitem").filter({ hasText: "Unused call" });
  await expect(unused).toContainText("Unused callers · v1");
  await expect(unused).toContainText("Outside reachable workflow");
  await expect(unused.getByRole("button")).toHaveCount(0);
  await expect(references.getByText("Other version", { exact: true })).toHaveCount(0);

  await references
    .getByRole("button", { name: "Open step Nested call in Nested callers · v1" })
    .press("Enter");
  await expect(stepName).toHaveValue("Nested call");
  await expect(stepName).toBeFocused();
  await expect(breadcrumbs.getByRole("button")).toHaveText([
    "Definition reference test",
    "Nested callers v1",
  ]);
  await back.press("Enter");
  await expect(stepName).toHaveValue("Inspect the method");
  await expect(stepName).toBeFocused();
  await expect(breadcrumbs).toContainText("Shared method v1");

  await disclosure.click();
  await references.getByRole("button", { name: "Open step Root call in Root workflow" }).click();
  await expect(stepName).toHaveValue("Root call");
  await expect(breadcrumbs).toHaveCount(0);
  await back.click();
  await expect(stepName).toHaveValue("Inspect the method");
  await expect(page.getByRole("button", { name: "Undo last edit", exact: true })).toBeDisabled();
  await expect(page.locator(".save-state")).toHaveText(`Revision ${revision.number}`);
});
