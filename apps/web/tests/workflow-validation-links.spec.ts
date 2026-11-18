import { expect, test } from "./fixtures";
import example from "../../../examples/research-workflow.json";
import { addTemplate, referenceOf } from "../src/lib/workflow-editing";
import type { Workflow } from "../src/lib/workflow";
import { workflowStepAtValidationLocation } from "../src/lib/workflow-validation";

function nestedWorkflow() {
  const outer = addTemplate(example as Workflow, null, "subgraph", example.start_node);
  const outerNode = outer.workflow.nodes.find((node) => node.id === outer.selected)!;
  const inner = addTemplate(outer.workflow, referenceOf(outerNode)!, "loop", "step");
  const body = inner.workflow.subgraphs![1]!;
  body.name = "Evidence loop";
  body.nodes[0]!.label = "Check an alternate input";
  return inner.workflow;
}

test("validation links open the affected root and nested draft steps", async ({
  page,
  request,
}) => {
  const saved = await request.post("/api/revisions", { data: nestedWorkflow() });
  expect(saved.status()).toBe(201);
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.goto(`/?revision=${(await saved.json()).id}&view=workflow`);
  const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
  await expect(stepName).toHaveValue("Frame the question");
  const nextStep = page.getByRole("combobox", { name: "Next step", exact: true });
  const validate = page.getByRole("button", { name: "Validate workflow", exact: true });
  const error = page.locator(".workspace-error");
  const undo = page.getByRole("button", { name: "Undo last edit", exact: true });

  await nextStep.selectOption("");
  await page.locator(".node-outline").getByRole("button", { name: "Human review" }).click();
  await validate.click();
  await expect(error).toContainText("must connect each declared control output");
  await error.getByRole("button", { name: "Open step Frame the question" }).click();
  await expect(stepName).toBeFocused();
  await expect(stepName).toHaveValue("Frame the question");
  await expect(nextStep).toHaveValue("");
  await undo.click();
  await expect(error).toHaveCount(0);

  const search = page.getByRole("searchbox", { name: "Find a step", exact: true });
  await search.fill("Check an alternate input");
  await search.press("Enter");
  await expect(stepName).toHaveValue("Check an alternate input");
  await search.fill("");
  await nextStep.selectOption("");
  const crumbs = page.getByRole("navigation", { name: "Graph breadcrumbs" });
  await crumbs.getByRole("button", { name: "Hypothesis review", exact: true }).click();
  await validate.click();
  await expect(error).toContainText("subgraphs.1.nodes.0");
  await error.getByRole("button", { name: "Open step Check an alternate input" }).press("Enter");
  await expect(crumbs.locator("li")).toHaveCount(3);
  await expect(crumbs.getByRole("button", { name: "Evidence loop v1" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(stepName).toBeFocused();
  await expect(stepName).toHaveValue("Check an alternate input");
  await expect(nextStep).toHaveValue("");
  await undo.click();
  await expect(nextStep).toHaveValue("finish");

  await page.getByText("Local draft & export", { exact: true }).click();
  const invalidImport = structuredClone(example);
  invalidImport.nodes[0]!.label = "";
  await page.getByLabel("Import workflow JSON", { exact: true }).setInputFiles({
    name: "different-workflow.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(invalidImport)),
  });
  await expect(error).toContainText("nodes.0.label");
  await expect(error.getByRole("button", { name: /Open (step|input)/ })).toHaveCount(0);
  await expect(stepName).toHaveValue("Check an alternate input");
});

test("validation links focus the nested input with an unavailable source", async ({
  page,
  request,
}) => {
  const workflow = nestedWorkflow();
  const { id, version } = workflow.subgraphs![1]!;
  const later = addTemplate(workflow, { id, version }, "note", "step");
  const saved = await request.post("/api/revisions", { data: later.workflow });
  expect(saved.status()).toBe(201);
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.goto(`/?revision=${(await saved.json()).id}&view=workflow`);

  const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
  await expect(stepName).toHaveValue("Frame the question");
  const search = page.getByRole("searchbox", { name: "Find a step", exact: true });
  await search.fill("Check an alternate input");
  await search.press("Enter");
  await expect(stepName).toHaveValue("Check an alternate input");
  const textInput = page.getByRole("combobox", { name: "Text input", exact: true });
  const unavailable = `${later.selected}:text`;
  await textInput.selectOption(unavailable);
  const crumbs = page.getByRole("navigation", { name: "Graph breadcrumbs" });
  await crumbs.getByRole("button", { name: "Hypothesis review", exact: true }).click();
  const prior = await stepName.inputValue();

  const validate = page.getByRole("button", { name: "Validate workflow", exact: true });
  await validate.click();
  const error = page.locator(".workspace-error");
  await expect(error).toContainText("subgraphs.1.nodes.0.inputs.text");
  const openInput = error.getByRole("button", {
    name: "Open input text on Check an alternate input",
  });
  await openInput.press("Enter");
  await expect(crumbs.getByRole("button", { name: "Evidence loop v1" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(textInput).toBeFocused();
  await expect(textInput).toHaveValue(unavailable);
  await openInput.click();
  await expect(textInput).toBeFocused();

  await page.getByRole("button", { name: `Return to step ${prior}`, exact: true }).click();
  await expect(stepName).toHaveValue(prior);
  await expect(stepName).toBeFocused();
  await openInput.click();
  await textInput.selectOption("brief");
  await expect(error).toHaveCount(0);
  await validate.click();
  await expect(page.getByRole("status", { name: "Workspace status" })).toHaveText(
    "Workflow valid. Ready to run.",
  );
});

test("validation locations distinguish editable inputs from step-only fields", () => {
  const workflow = nestedWorkflow();
  expect(
    workflowStepAtValidationLocation(workflow, ["body", "workflow", "nodes", 0, "inputs", "text"]),
  ).toMatchObject({ input: "text", path: [], step: { id: "frame" } });
  const nested = ["body", "subgraphs", 1, "nodes", 0];
  const location = (suffix: (string | number)[]) =>
    workflowStepAtValidationLocation(workflow, [...nested, ...suffix]);
  const input = location(["inputs", "text", "node_id"]);
  expect(input?.path).toHaveLength(2);
  expect(input?.input).toBe("text");
  for (const suffix of [["inputs"], ["inputs", "unknown"], ["inputs", "in"]]) {
    expect(location(suffix)?.step.id).toBe("step");
    expect(location(suffix)?.input).toBeUndefined();
  }

  const route = addTemplate(workflow, null, "route", "frame");
  const index = route.workflow.nodes.findIndex((step) => step.id === route.selected);
  const condition = workflowStepAtValidationLocation(route.workflow, [
    "body",
    "nodes",
    index,
    "config",
    "condition",
  ]);
  expect(condition?.step.id).toBe(route.selected);
  expect(condition?.input).toBeUndefined();
});

test("validation links require a unique reachable step in the submitted document", () => {
  const workflow = nestedWorkflow();
  expect(
    workflowStepAtValidationLocation(workflow, ["body", "workflow", "nodes", 0, "label"])?.step.id,
  ).toBe("frame");
  const location = ["body", "subgraphs", 1, "nodes", 0, "config"];
  expect(workflowStepAtValidationLocation(workflow, location)?.path).toHaveLength(2);
  expect(workflowStepAtValidationLocation(workflow, ["body"])).toBeUndefined();
  expect(workflowStepAtValidationLocation(workflow, ["query", "nodes", 0])).toBeUndefined();
  expect(workflowStepAtValidationLocation(workflow, ["body", "nodes", 0.5])).toBeUndefined();
  const body = workflow.subgraphs![1]!;
  workflow.subgraphs!.push(structuredClone(body));
  expect(workflowStepAtValidationLocation(workflow, location)).toBeUndefined();
  workflow.subgraphs!.pop();
  workflow.subgraphs![0]!.nodes = workflow.subgraphs![0]!.nodes.filter(
    (node) => node.config?.type !== "loop",
  );
  expect(workflowStepAtValidationLocation(workflow, location)).toBeUndefined();
});
