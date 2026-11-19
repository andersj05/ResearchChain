import { expect, test } from "./fixtures";
import macro from "../../../examples/discretionary-macro.json";
import advanced from "../../../examples/advanced-workflow.json";
import { addTemplate, insertStep } from "../src/lib/workflow-editing";
import type { Workflow } from "../src/lib/workflow";

test("open macro input sources and keep stale bindings editable on a phone", async ({
  page,
  request,
}) => {
  const note = addTemplate(structuredClone(macro) as Workflow, null, "note", "challenge");
  const code = addTemplate(note.workflow, null, "code", note.selected);
  const route = addTemplate(code.workflow, null, "route", code.selected);
  const noteStep = route.workflow.nodes.find((node) => node.id === note.selected)!;
  noteStep.label = "Record the transmission test";
  noteStep.inputs = { text: { source: "output", node_id: "challenge", port: "text" } };
  const codeStep = route.workflow.nodes.find((node) => node.id === code.selected)!;
  codeStep.label = "Score the transmission test";
  codeStep.inputs = {
    text: { source: "output", node_id: note.selected, port: "text" },
    number: { source: "artifact_count" },
  };
  const routeStep = route.workflow.nodes.find((node) => node.id === route.selected)!;
  routeStep.label = "Test evidence threshold";
  if (routeStep.config?.type !== "route") throw new Error("Expected the condition template.");
  routeStep.config.condition.left = { source: "output", node_id: code.selected, port: "number" };

  const saved = await request.post("/api/revisions", { data: route.workflow });
  expect(saved.ok(), await saved.text()).toBe(true);
  const revision = await saved.json();
  await page.setViewportSize({ width: 390, height: 950 });
  await page.goto(`/?revision=${revision.id}`);
  const outline = page.locator(".node-outline");
  const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
  const inspector = page.locator("#node-inspector");
  const source = (producer: string, field: string) =>
    inspector.getByRole("button", { name: `Open source ${producer} for ${field}`, exact: true });
  const undo = page.getByRole("button", { name: "Undo last edit", exact: true });

  await outline.getByRole("button", { name: /Run the discriminating test/ }).click();
  const context = page.getByRole("combobox", { name: "Context input", exact: true });
  await expect(context).toHaveValue("pricing:text");
  await source("Estimate what markets price", "Context input").press("Enter");
  await expect(stepName).toHaveValue("Estimate what markets price");
  await expect(stepName).toBeFocused();
  await page.getByRole("button", { name: "Return to step Run the discriminating test" }).click();
  await expect(context).toHaveValue("pricing:text");
  await expect(page.getByRole("combobox", { name: "Reviewer feedback", exact: true })).toHaveValue(
    "mandate:feedback",
  );
  await source("Choose the question and horizon", "Reviewer feedback").click();
  await expect(stepName).toHaveValue("Choose the question and horizon");

  const openCondition = outline.getByRole("button", { name: /^Test evidence threshold/ });
  const condition = page.getByRole("combobox", { name: "Condition value source", exact: true });
  await openCondition.click();
  await expect(condition).toHaveValue(`${code.selected}:number`);
  await source(codeStep.label, "Condition value source").click();
  await expect(stepName).toHaveValue(codeStep.label);
  await expect(page.getByRole("combobox", { name: "Code text input", exact: true })).toHaveValue(
    `${note.selected}:text`,
  );
  await expect(page.getByRole("combobox", { name: "Code number input", exact: true })).toHaveValue(
    "artifact_count",
  );
  await expect(inspector.getByRole("button", { name: /^Open source/ })).toHaveCount(1);
  await source(noteStep.label, "Code text input").click();
  await expect(page.getByRole("combobox", { name: "Text input", exact: true })).toHaveValue(
    "challenge:text",
  );
  await source("Challenge the transmission story", "Text input").click();
  await expect(stepName).toHaveValue("Challenge the transmission story");
  await expect(undo).toBeDisabled();
  await expect(page.locator(".save-state")).toHaveText(`Revision ${revision.number}`);

  await outline.getByRole("button", { name: /Score the transmission test/ }).click();
  await page.getByRole("button", { name: "Remove step", exact: true }).click();
  await openCondition.click();
  await expect(condition.locator("option:checked")).toContainText("Missing source");
  await expect(inspector.getByRole("button", { name: /^Open source/ })).toHaveCount(0);
  await condition.selectOption("artifact_count");
  await expect(condition).toHaveValue("artifact_count");
  await expect(inspector.getByRole("button", { name: /^Open source/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("open a loop stop source through its owning instance and pinned body", async ({
  page,
  request,
}) => {
  const workflow = structuredClone(advanced) as Workflow;
  const loop = workflow.nodes.find((node) => node.id === "review_loop")!;
  if (loop.config?.type !== "loop") throw new Error("Expected a bounded loop.");
  loop.config.until = {
    left: { source: "output", node_id: "review", port: "decision" },
    operator: "equals",
    value: "approve",
  };
  const newer = structuredClone(workflow.subgraphs![0]!);
  newer.version = 2;
  newer.nodes[0]!.label = "Review in a different version";
  workflow.subgraphs!.push(newer);
  const other = { ...loop, id: "second_review_loop", label: "Second review loop" };
  const saved = await request.post("/api/revisions", {
    data: insertStep(workflow, other, loop.id),
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  await page.goto(`/?revision=${(await saved.json()).id}`);

  await page
    .locator(".node-outline")
    .getByRole("button", { name: /^Second review loop/ })
    .click();
  const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
  const stop = page.getByRole("combobox", { name: "Stop condition value source", exact: true });
  const source = page.getByRole("button", {
    name: "Open source Review for Stop condition value source",
    exact: true,
  });
  await expect(stop).toHaveValue("review:decision");
  await source.press("Enter");
  await expect(stepName).toHaveValue("Review");
  await expect(stepName).toBeFocused();
  const crumbs = page.getByRole("navigation", { name: "Graph breadcrumbs" });
  await expect(crumbs).toContainText("Critique and review v1");
  await crumbs.getByRole("button", { name: "Parallel evidence review", exact: true }).click();
  await expect(stepName).toHaveValue("Second review loop");
  await source.click();
  await page.getByRole("button", { name: "Return to step Second review loop" }).press("Enter");
  await expect(stop).toHaveValue("review:decision");
  await expect(page.getByRole("button", { name: "Undo last edit", exact: true })).toBeDisabled();
});
