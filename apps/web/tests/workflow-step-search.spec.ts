import { expect, test } from "./fixtures";
import workflow from "../../../examples/advanced-workflow.json";
import macro from "../../../examples/discretionary-macro.json";
import { addTemplate } from "../src/lib/workflow-editing";
import type { Workflow } from "../src/lib/workflow";

test("find a nested review by its question and return to an editable root step", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/revisions", { data: workflow });
  expect(response.status()).toBe(201);
  const revision = await response.json();
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(`/?revision=${revision.id}`);
  const search = page.getByRole("searchbox", { name: "Find a step" });
  const matches = page.getByRole("list", { name: "Matching steps" });
  const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
  const instructions = page.getByRole("textbox", { name: "Instructions", exact: true });
  const breadcrumbs = page.getByRole("navigation", { name: "Graph breadcrumbs" });
  await search.fill("ready for the next pass");
  await expect(matches.getByRole("listitem")).toHaveCount(1);
  await expect(matches.getByRole("button")).toContainText("Critique and review · v1");
  await search.press("Enter");
  await expect(breadcrumbs).toContainText("Critique and review");
  await expect(stepName).toHaveValue("Review");
  await expect(stepName).toBeFocused();
  await expect(instructions).toHaveValue("Is this reasoning ready for the next pass?");

  await search.fill("what would falsify it");
  await matches.getByRole("button", { name: /Challenge/ }).click();
  await expect(stepName).toHaveValue("Challenge");
  await expect(stepName).toBeFocused();
  await expect(breadcrumbs).toHaveCount(0);
  await expect(page.locator(".save-state")).toHaveText(`Revision ${revision.number}`);
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(matches).toHaveCount(0);
  await expect(stepName).toHaveValue("Challenge");

  const macroResponse = await request.post("/api/revisions", { data: macro });
  expect(macroResponse.status()).toBe(201);
  await page.goto(`/?revision=${(await macroResponse.json()).id}`);
  await search.fill(macro.research.model);
  await expect(matches.getByRole("listitem")).toHaveCount(
    macro.nodes.filter((node) => node.kind === "research").length,
  );
});

test("return to a nested step after a Build link and discard a stale version", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/revisions", { data: workflow });
  expect(response.status()).toBe(201);
  const revision = await response.json();
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(`/?revision=${revision.id}`);
  const search = page.getByRole("searchbox", { name: "Find a step" });
  const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
  const breadcrumbs = page.getByRole("navigation", { name: "Graph breadcrumbs" });
  const returnToStep = page.getByRole("button", { name: /^Return to step / });
  const undo = page.getByRole("button", { name: "Undo last edit", exact: true });

  await search.fill("ready for the next pass");
  await search.press("Enter");
  await expect(stepName).toHaveValue("Review");
  await expect(returnToStep).toHaveAccessibleName("Return to step Split");
  await search.fill("what would falsify it");
  await search.press("Enter");
  await expect(stepName).toHaveValue("Challenge");
  await expect(returnToStep).toHaveAccessibleName("Return to step Review");
  await expect(breadcrumbs).toHaveCount(0);

  await returnToStep.press("Enter");
  await expect(stepName).toHaveValue("Review");
  await expect(stepName).toBeFocused();
  await expect(breadcrumbs).toContainText("Critique and review v1");
  await expect(returnToStep).toHaveCount(0);
  await expect(undo).toBeDisabled();

  await search.fill("review_loop");
  await search.press("Enter");
  await expect(stepName).toHaveValue("Review_Loop");
  await expect(returnToStep).toHaveAccessibleName("Return to step Review");
  await page.getByRole("button", { name: "New version", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Subgraph version" })).toHaveValue("critique@2");
  await expect(returnToStep).toHaveCount(0);
  await expect(undo).toBeEnabled();
});

test("inspect and follow a review handoff while building the macro workflow", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/revisions", { data: macro });
  expect(response.status()).toBe(201);
  const revision = await response.json();
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(`/?revision=${revision.id}`);

  const outline = page.locator(".node-outline");
  const mandate = outline.getByRole("button", { name: /Choose the question and horizon/ });
  const undo = page.getByRole("button", { name: "Undo last edit" });
  const handoff = page.getByRole("group", { name: "Review handoff" });
  const testBinding = handoff.getByRole("button", {
    name: "Run the discriminating test · feedback",
  });
  await mandate.click();
  await expect(handoff.getByText("Find the cross-asset tension", { exact: true })).toBeVisible();
  await expect(handoff.getByRole("button")).toHaveText([
    "Estimate what markets price · feedback",
    "Run the discriminating test · feedback",
    "Challenge the transmission story · feedback",
  ]);
  await testBinding.press("Enter");
  const input = page.getByRole("combobox", { name: "Reviewer feedback" });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("mandate:feedback");
  await expect(undo).toBeDisabled();
  await expect(page.locator(".save-state")).toHaveText(`Revision ${revision.number}`);
  await page
    .getByRole("button", { name: "Return to step Choose the question and horizon" })
    .click();
  await expect(handoff).toBeVisible();
  await testBinding.press("Enter");
  await expect(input).toBeFocused();

  await input.selectOption("");
  await mandate.click();
  await expect(testBinding).toHaveCount(0);
  await undo.click();
  await expect(testBinding).toBeVisible();

  await outline.getByRole("button", { name: /Decide whether the view is ready/ }).click();
  await expect(
    handoff.getByText("No step inputs are wired to this feedback.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Validate workflow", exact: true }).click();
  await expect(page.getByRole("status", { name: "Workspace status" })).toHaveText(
    "Workflow valid. Ready to run.",
  );
});

test("follow macro output bindings to exact inputs and see edits reflected in Build", async ({
  page,
  request,
}) => {
  const draft = addTemplate(structuredClone(macro) as Workflow, null, "note", "challenge");
  const consumer = draft.workflow.nodes.find((node) => node.id === draft.selected)!;
  consumer.label = "Record discriminating evidence";
  consumer.inputs = { text: { source: "output", node_id: "test", port: "text" } };
  const response = await request.post("/api/revisions", { data: draft.workflow });
  expect(response.status()).toBe(201);
  const revision = await response.json();
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(`/?revision=${revision.id}`);

  const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
  const undo = page.getByRole("button", { name: "Undo last edit", exact: true });
  const disclosure = page.getByText("Output bindings", { exact: true });
  const bindings = page.getByRole("list", { name: "Step inputs in this graph" });
  const challenge = bindings.getByRole("button", {
    name: "text → Challenge the transmission story · context",
    exact: true,
  });
  const note = bindings.getByRole("button", {
    name: "text → Record discriminating evidence · text",
    exact: true,
  });
  const back = page.getByRole("button", { name: "Return to step Run the discriminating test" });
  await page
    .locator(".node-outline")
    .getByRole("button", { name: /Run the discriminating test/ })
    .click();
  await expect(bindings).toBeHidden();
  await disclosure.click();
  await expect(bindings.getByRole("listitem")).toHaveCount(2);

  await challenge.press("Enter");
  const context = page.getByRole("combobox", { name: "Context input", exact: true });
  await expect(context).toBeFocused();
  await expect(context).toHaveValue("test:text");
  await back.press("Enter");
  await expect(stepName).toHaveValue("Run the discriminating test");
  await expect(stepName).toBeFocused();

  await note.press("Enter");
  const text = page.getByRole("combobox", { name: "Text input", exact: true });
  await expect(text).toBeFocused();
  await expect(text).toHaveValue("test:text");
  await expect(undo).toBeDisabled();
  await expect(page.locator(".save-state")).toHaveText(`Revision ${revision.number}`);
  await text.selectOption("");
  await back.press("Enter");
  await expect(note).toHaveCount(0);
  await expect(challenge).toBeVisible();

  await challenge.press("Enter");
  await context.selectOption("");
  await back.press("Enter");
  await expect(
    page.getByText("No step inputs or conditions in this graph use these outputs."),
  ).toBeVisible();
  await undo.click();
  await expect(challenge).toBeVisible();
  await expect(note).toHaveCount(0);
});

test("follow condition bindings from code output and review feedback as wiring changes", async ({
  page,
  request,
}) => {
  const review = addTemplate(
    structuredClone(workflow) as Workflow,
    null,
    "review",
    "split",
    "before",
  );
  const code = addTemplate(review.workflow, null, "code", review.selected);
  const route = addTemplate(code.workflow, null, "route", "support", "before");
  const graph: Workflow = { ...route.workflow, schema_version: "0.3" };
  const condition = graph.nodes.find((step) => step.id === route.selected)!;
  if (condition.config?.type !== "route") throw new Error("Missing test condition.");
  condition.label = "Confirm the evidence signal";
  condition.config.condition = {
    left: { source: "output", node_id: code.selected, port: "number" },
    operator: "gte",
    value: 1,
  };
  graph.nodes.find((step) => step.id === "support")!.inputs = {
    text: { source: "output", node_id: review.selected, port: "feedback" },
  };
  graph.nodes.find((step) => step.id === "challenge")!.inputs = {
    text: { source: "output", node_id: code.selected, port: "text" },
  };
  const response = await request.post("/api/revisions", { data: graph });
  expect(response.status(), await response.text()).toBe(201);
  const revision = await response.json();
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(`/?revision=${revision.id}`);

  const outline = page.locator(".node-outline");
  const codeStep = graph.nodes.find((step) => step.id === code.selected)!;
  const reviewStep = graph.nodes.find((step) => step.id === review.selected)!;
  const returnTo = (name: string) =>
    page.getByRole("button", { name: `Return to step ${name}`, exact: true });
  const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
  const conditionGroup = page.getByRole("group", { name: "Condition", exact: true });
  const source = conditionGroup.getByRole("combobox", { name: "Condition value source" });
  const conditions = page.getByRole("list", { name: "Conditions in this graph" });
  const inputs = page.getByRole("list", { name: "Step inputs in this graph" });
  await outline.getByRole("button", { name: new RegExp(codeStep.label) }).click();
  await page.getByText("Output bindings", { exact: true }).press("Enter");
  await expect(inputs.getByRole("button")).toHaveText(["text → Challenge · text"]);
  await conditions
    .getByRole("button", { name: "number → Confirm the evidence signal · condition" })
    .press("Enter");
  await expect(conditionGroup).toBeFocused();
  await expect(source).toHaveValue(`${code.selected}:number`);
  await expect(page.getByRole("button", { name: "Undo last edit" })).toBeDisabled();
  await expect(page.locator(".save-state")).toHaveText(`Revision ${revision.number}`);

  await source.selectOption(`${review.selected}:feedback`);
  await returnTo(codeStep.label).press("Enter");
  await expect(stepName).toBeFocused();
  await expect(stepName).toHaveValue(codeStep.label);
  await expect(inputs.getByRole("button")).toHaveText(["text → Challenge · text"]);
  await expect(conditions).toHaveCount(0);

  await outline.getByRole("button", { name: new RegExp(reviewStep.label) }).click();
  const handoff = page.getByRole("group", { name: "Review handoff" });
  const feedbackConditions = handoff.getByRole("list", { name: "Conditions using this feedback" });
  await expect(handoff.getByRole("button", { name: "Support · text" })).toBeVisible();
  await feedbackConditions
    .getByRole("button", { name: "Confirm the evidence signal · condition" })
    .press("Enter");
  await expect(conditionGroup).toBeFocused();
  await expect(source).toHaveValue(`${review.selected}:feedback`);
  await source.selectOption(`${review.selected}:decision`);
  await returnTo(reviewStep.label).press("Enter");
  await expect(stepName).toBeFocused();
  await expect(stepName).toHaveValue(reviewStep.label);
  await expect(handoff.getByRole("button", { name: "Support · text" })).toBeVisible();
  await expect(feedbackConditions).toHaveCount(0);
});
