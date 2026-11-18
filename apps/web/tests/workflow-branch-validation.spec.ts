import example from "../../../examples/research-workflow.json";
import { addTemplate, referenceOf } from "../src/lib/workflow-editing";
import type { Workflow } from "../src/lib/workflow";
import { expect, test, type APIRequestContext, type Page } from "./fixtures";

async function openBuild(page: Page, request: APIRequestContext, workflow: Workflow) {
  const saved = await request.post("/api/revisions", { data: workflow });
  expect(saved.status()).toBe(201);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/?revision=${(await saved.json()).id}&view=workflow`);
}

test("branch validation opens the condition in a nested workflow", async ({ page, request }) => {
  const outer = addTemplate(example as Workflow, null, "subgraph", example.start_node);
  const owner = outer.workflow.nodes.find((node) => node.id === outer.selected)!;
  const route = addTemplate(outer.workflow, referenceOf(owner)!, "route", "step");
  const body = route.workflow.subgraphs![0]!;
  const decision = body.nodes.find((node) => node.id === route.selected)!;
  decision.label = "Choose a deeper evidence check";
  const laterStep = body.edges.find(
    (edge) => edge.source === decision.id && edge.source_port === "true",
  )!.target;
  await openBuild(page, request, route.workflow);

  const name = page.getByRole("textbox", { name: "Step name", exact: true });
  const search = page.getByRole("searchbox", { name: "Find a step" });
  await search.fill(decision.label);
  await search.press("Enter");
  const source = page.getByRole("combobox", { name: "Condition value source" });
  await source.selectOption(`${laterStep}:text`);
  const breadcrumbs = page.getByRole("navigation", { name: "Graph breadcrumbs" });
  await breadcrumbs.getByRole("button", { name: route.workflow.name, exact: true }).click();
  await expect(name).toHaveValue(owner.label);
  const validate = page.getByRole("button", { name: "Validate workflow", exact: true });
  await validate.click();

  const error = page.locator(".workspace-error");
  await expect(error).toContainText("not available on every incoming path");
  await error.getByRole("button", { name: `Open condition on ${decision.label}` }).press("Enter");
  await expect(name).toHaveValue(decision.label);
  await expect(page.getByRole("group", { name: "Condition", exact: true })).toBeFocused();
  await expect(source).toHaveValue(`${laterStep}:text`);
  await expect(breadcrumbs.getByRole("button", { name: `${body.name} v1` })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await source.selectOption("artifact_count");
  await validate.click();
  await expect(page.getByRole("status", { name: "Workspace status" })).toHaveText(
    "Workflow valid. Ready to run.",
  );
  await page
    .getByRole("button", { name: `Return to step ${owner.label}`, exact: true })
    .press("Enter");
  await expect(name).toHaveValue(owner.label);
});

test("branch validation focuses a split's conflicting join setting", async ({ page, request }) => {
  const first = addTemplate(example as Workflow, null, "route", example.start_node);
  const firstSplit = first.workflow.nodes.find((node) => node.id === first.selected)!;
  if (firstSplit.config?.type !== "route") throw new Error("Missing condition");
  const second = addTemplate(first.workflow, null, "fork", firstSplit.config.join);
  const secondSplit = second.workflow.nodes.find((node) => node.id === second.selected)!;
  if (secondSplit.config?.type !== "fork") throw new Error("Missing parallel split");
  secondSplit.label = "Run the rival explanations";
  const originalJoin = secondSplit.config.join;
  await openBuild(page, request, second.workflow);

  const outline = page.locator(".node-outline");
  await outline.getByRole("button", { name: new RegExp(secondSplit.label) }).click();
  const join = page.getByRole("combobox", { name: "Join step", exact: true });
  await join.selectOption(firstSplit.config.join);
  await outline.getByRole("button", { name: "Frame the question" }).click();
  const validate = page.getByRole("button", { name: "Validate workflow", exact: true });
  await validate.click();

  const error = page.locator(".workspace-error");
  await expect(error).toContainText("Each split requires its own existing join node");
  await error
    .getByRole("button", { name: `Open join setting on ${secondSplit.label}` })
    .press("Enter");
  await expect(join).toBeFocused();
  await expect(join).toHaveValue(firstSplit.config.join);

  await join.selectOption(originalJoin);
  await validate.click();
  await expect(page.getByRole("status", { name: "Workspace status" })).toHaveText(
    "Workflow valid. Ready to run.",
  );
});

test("validation opens the stop condition on the loop that owns it", async ({ page, request }) => {
  const outer = addTemplate(example as Workflow, null, "subgraph", example.start_node);
  const owner = outer.workflow.nodes.find((node) => node.id === outer.selected)!;
  const parent = referenceOf(owner)!;
  const loop = addTemplate(outer.workflow, parent, "loop", "step");
  const ownerGraph = loop.workflow.subgraphs![0]!;
  const repeat = ownerGraph.nodes.find((node) => node.id === loop.selected)!;
  repeat.label = "Repeat the rates check";
  const loopBody = loop.workflow.subgraphs![1]!;
  const route = addTemplate(loop.workflow, referenceOf(repeat)!, "route", loopBody.start_node);
  const branchOnlyOutput = route.workflow.subgraphs![1]!.edges.find(
    (edge) => edge.source === route.selected && edge.source_port === "true",
  )!.target;
  await openBuild(page, request, route.workflow);

  const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
  const search = page.getByRole("searchbox", { name: "Find a step" });
  await search.fill(repeat.label);
  await search.press("Enter");
  await page.getByRole("combobox", { name: "Stop rule", exact: true }).selectOption("condition");
  const source = page.getByRole("combobox", { name: "Stop condition value source" });
  await source.selectOption(`${branchOnlyOutput}:text`);
  await page
    .getByRole("navigation", { name: "Graph breadcrumbs" })
    .getByRole("button", { name: route.workflow.name, exact: true })
    .click();
  await expect(stepName).toHaveValue(owner.label);

  const validate = page.getByRole("button", { name: "Validate workflow", exact: true });
  await validate.click();
  const problem = page.locator(".workspace-error");
  await expect(problem).toContainText("not available on every incoming path");
  await problem
    .getByRole("button", { name: `Open stop condition on ${repeat.label}`, exact: true })
    .press("Enter");
  await expect(stepName).toHaveValue(repeat.label);
  await expect(page.getByRole("group", { name: "Stop condition", exact: true })).toBeFocused();
  await expect(source).toHaveValue(`${branchOnlyOutput}:text`);

  await source.selectOption("iteration");
  await validate.click();
  await expect(page.getByRole("status", { name: "Workspace status" })).toHaveText(
    "Workflow valid. Ready to run.",
  );
  await page
    .getByRole("button", { name: `Return to step ${owner.label}`, exact: true })
    .press("Enter");
  await expect(stepName).toHaveValue(owner.label);
});
