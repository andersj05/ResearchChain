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

test("return through graph breadcrumbs to the exact callers while keeping nested edits", async ({
  page,
  request,
}) => {
  const parent = { id: "parent", version: 1 };
  const method = { id: "method", version: 2 };
  const originalQuestion = "What evidence would change this conclusion?";
  const workflow: Workflow = {
    schema_version: "0.2",
    ...chain(
      "Compare regional evidence",
      step("root_a", "First analysis call", "subgraph", { type: "subgraph", ref: parent }),
      step("root_b", "Second analysis call", "subgraph", { type: "subgraph", ref: parent }),
    ),
    subgraphs: [
      {
        ...parent,
        ...chain(
          "Evidence analysis",
          step("intro", "Read the evidence brief", "note"),
          step("run_method", "Apply pinned method", "subgraph", { type: "subgraph", ref: method }),
        ),
      },
      {
        ...method,
        version: 3,
        ...chain("Scenario check", step("experimental", "Experimental check", "note")),
      },
      {
        ...method,
        ...chain("Scenario check", step("intro", "Read the scenario", "note"), {
          ...step("verify", "Check the scenario", "review"),
          instructions: originalQuestion,
        }),
      },
    ],
  };
  const saved = await request.post("/api/revisions", { data: workflow });
  expect(saved.status(), await saved.text()).toBe(201);
  const revision = await saved.json();
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(`/?revision=${revision.id}`);

  const outline = page.locator(".node-outline");
  const editSubgraph = page.getByRole("button", { name: "Edit subgraph", exact: true });
  const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
  const question = page.getByRole("textbox", { name: "Review question", exact: true });
  const breadcrumbs = page.getByRole("navigation", { name: "Graph breadcrumbs" });
  const root = breadcrumbs.getByRole("button", { name: workflow.name, exact: true });
  const ancestor = breadcrumbs.getByRole("button", { name: "Evidence analysis v1", exact: true });
  const current = breadcrumbs.getByRole("button", { name: "Scenario check v2", exact: true });
  const selectMethod = outline.getByRole("button", { name: /^Apply pinned method/ });
  const selectReview = outline.getByRole("button", { name: /^Check the scenario/ });

  await outline.getByRole("button", { name: /^Second analysis call/ }).click();
  await editSubgraph.click();
  await selectMethod.click();
  await editSubgraph.click();
  await expect(current).toHaveAttribute("aria-current", "page");
  await expect(current).toHaveAccessibleDescription("Go to the first step, Read the scenario");
  await selectReview.click();
  await question.fill("How sensitive is the conclusion to this scenario?");
  await current.press("Enter");
  await expect(stepName).toHaveValue("Read the scenario");
  await expect(stepName).toBeFocused();

  await expect(ancestor).toHaveAccessibleDescription("Return to Apply pinned method");
  await ancestor.press("Enter");
  await expect(ancestor).toHaveAttribute("aria-current", "page");
  await expect(stepName).toHaveValue("Apply pinned method");
  await expect(stepName).toBeFocused();
  await expect(root).toHaveAccessibleDescription("Return to Second analysis call");
  await root.press("Enter");
  await expect(breadcrumbs).toHaveCount(0);
  await expect(stepName).toHaveValue("Second analysis call");
  await expect(stepName).toBeFocused();

  await editSubgraph.click();
  await selectMethod.click();
  await editSubgraph.click();
  await expect(current).toHaveAttribute("aria-current", "page");
  await selectReview.click();
  await expect(question).toHaveValue("How sensitive is the conclusion to this scenario?");
  await expect(page.locator(".save-state")).toHaveText("Unsaved draft");
  const undo = page.getByRole("button", { name: "Undo last edit", exact: true });
  await undo.click();
  await expect(question).toHaveValue(originalQuestion);
  await expect(undo).toBeDisabled();
  await expect(page.locator(".save-state")).toHaveText(`Revision ${revision.number}`);
});
