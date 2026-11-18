import { expect, test } from "./fixtures";
import macro from "../../../examples/discretionary-macro.json";
import { addTemplate, referenceOf } from "../src/lib/workflow-editing";
import type { Workflow } from "../src/lib/workflow";

test("Review plan shows macro questions and feedback in pinned nested graphs", async ({
  page,
  request,
}) => {
  const call = addTemplate(structuredClone(macro) as Workflow, null, "subgraph", "test");
  const ref = referenceOf(call.workflow.nodes.find((node) => node.id === call.selected)!)!;
  const memo = addTemplate(call.workflow, ref, "note", "step");
  const checkpoint = addTemplate(memo.workflow, ref, "review", memo.selected);
  const routed = addTemplate(checkpoint.workflow, ref, "route", memo.selected);
  const body = routed.workflow.subgraphs![0]!;
  body.name = "Transmission check";
  const review = body.nodes.find((node) => node.id === "step")!;
  review.kind = "review";
  review.label = "Confirm the transmission channel";
  review.instructions = "Which price move isolates the proposed policy channel?";
  const consumer = body.nodes.find((node) => node.id === memo.selected)!;
  consumer.label = "Record the owner’s judgment";
  consumer.inputs = { text: { source: "output", node_id: review.id, port: "feedback" } };
  const condition = body.nodes.find((node) => node.id === routed.selected)!;
  if (condition.config?.type !== "route") throw new Error("Missing condition");
  condition.label = "Look for a policy surprise";
  condition.config.condition = {
    left: { source: "output", node_id: review.id, port: "feedback" },
    operator: "contains",
    value: "policy",
  };
  body.nodes.find((node) => node.id === checkpoint.selected)!.label = "Decide on a second pass";
  const newer = structuredClone(body);
  newer.version = 2;
  newer.nodes.find((node) => node.id === review.id)!.instructions = "An unused question";
  routed.workflow.subgraphs!.push(newer);
  const saved = await request.post("/api/revisions", { data: routed.workflow });
  expect(saved.ok(), await saved.text()).toBe(true);
  const revision = await saved.json();
  await page.setViewportSize({ width: 390, height: 950 });
  await page.goto(`/?revision=${revision.id}`);

  const disclosure = page.getByText("Review plan", { exact: true });
  const plan = page.getByRole("list", { name: "Reachable review steps" });
  const rows = plan.locator(":scope > li");
  const rowFor = (label: string) =>
    rows.filter({ has: page.getByRole("button", { name: `Edit ${label} in` }) });
  const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
  const undo = page.getByRole("button", { name: "Undo last edit", exact: true });
  const back = page.getByRole("button", {
    name: "Return to step Find the cross-asset tension",
    exact: true,
  });
  const breadcrumbs = page.getByRole("navigation", { name: "Graph breadcrumbs" });
  const pinnedBody = breadcrumbs.getByRole("button", {
    name: "Transmission check v1",
    exact: true,
  });
  await expect(stepName).toHaveValue("Find the cross-asset tension");
  await expect(plan).toHaveCount(0);
  await disclosure.click();
  await expect(rows).toHaveCount(5);
  await expect(page.getByText("· 5 reviews", { exact: true })).toBeVisible();
  for (const step of macro.nodes.filter((node) => node.kind === "review")) {
    await expect(rowFor(step.label)).toContainText(step.instructions!);
  }
  const mandate = rowFor("Choose the question and horizon");
  const judgment = rowFor("Weigh the thesis and the dissent");
  const mandateWiring = mandate.locator("summary");
  const feedback = mandate.getByRole("list", { name: "Feedback bindings" });
  await expect(mandateWiring).toHaveText("Wiring · 3 feedback bindings");
  await expect(feedback).toHaveCount(0);
  await expect(mandate.getByRole("list", { name: "Previous control steps" })).toHaveCount(0);
  const listBox = (await plan.boundingBox())!;
  const judgmentBox = (await judgment
    .getByRole("button", { name: /^Edit Weigh the thesis/ })
    .boundingBox())!;
  expect(judgmentBox.y + judgmentBox.height).toBeLessThanOrEqual(listBox.y + listBox.height);
  await mandateWiring.press("Enter");
  await expect(feedback.getByRole("listitem")).toHaveText([
    "Estimate what markets price · feedback",
    "Run the discriminating test · feedback",
    "Challenge the transmission story · feedback",
  ]);
  await mandateWiring.press("Enter");
  await expect(feedback).toHaveCount(0);
  await judgment.locator("summary").press("Enter");
  await expect(judgment.getByRole("list", { name: "Feedback bindings" })).toContainText(
    "Build catalyst and risk scenarios · feedback",
  );
  await expect(rowFor("Decide whether the view is ready").locator("summary")).toHaveText(
    "Wiring · No feedback bindings",
  );
  await expect(rowFor("Decide on a second pass")).toContainText(
    "Continue this workflow? · Default question",
  );
  await rowFor("Weigh the thesis and the dissent")
    .getByRole("list", { name: "Previous control steps" })
    .getByRole("button", { name: "Challenge the transmission story", exact: true })
    .press("Enter");
  await expect(stepName).toHaveValue("Challenge the transmission story");
  await expect(stepName).toBeFocused();
  await back.press("Enter");
  await expect(stepName).toHaveValue("Find the cross-asset tension");
  await expect(undo).toBeDisabled();
  await disclosure.click();

  const nested = rowFor(review.label);
  await expect(nested).toContainText(review.instructions);
  await expect(nested).toContainText("Transmission check · v1");
  await expect(nested.locator("summary")).toHaveText("Wiring · 2 feedback bindings");
  await nested.locator("summary").press("Enter");
  const nestedBindings = nested.getByRole("list", { name: "Feedback bindings" });
  await expect(nestedBindings.getByRole("listitem")).toHaveText([
    "Record the owner’s judgment · text",
    "Look for a policy surprise · condition",
  ]);
  await expect(plan.getByText("An unused question", { exact: true })).toHaveCount(0);
  await nestedBindings
    .getByRole("button", {
      name: "Open Record the owner’s judgment · text in Transmission check · v1",
      exact: true,
    })
    .press("Enter");
  await expect(plan).toHaveCount(0);
  await expect(stepName).toHaveValue(consumer.label);
  await expect(pinnedBody).toHaveAttribute("aria-current", "page");
  const textInput = page.getByRole("combobox", { name: "Text input", exact: true });
  await expect(textInput).toBeFocused();
  await expect(textInput).toHaveValue(`${review.id}:feedback`);
  await back.press("Enter");
  await expect(stepName).toHaveValue("Find the cross-asset tension");
  await expect(stepName).toBeFocused();
  await expect(breadcrumbs).toHaveCount(0);

  await disclosure.click();
  await nested.locator("summary").press("Enter");
  await nestedBindings
    .getByRole("button", {
      name: "Open Look for a policy surprise · condition in Transmission check · v1",
      exact: true,
    })
    .click();
  await expect(plan).toHaveCount(0);
  await expect(stepName).toHaveValue(condition.label);
  await expect(pinnedBody).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("group", { name: "Condition", exact: true })).toBeFocused();
  await expect(
    page.getByRole("combobox", { name: "Condition value source", exact: true }),
  ).toHaveValue(`${review.id}:feedback`);
  await back.click();
  await expect(stepName).toHaveValue("Find the cross-asset tension");
  await expect(undo).toBeDisabled();
  await expect(page.locator(".save-state")).toHaveText(`Revision ${revision.number}`);

  await disclosure.click();
  await nested
    .getByRole("button", { name: `Edit ${review.label} in Transmission check · v1` })
    .press("Enter");
  await expect(plan).toHaveCount(0);
  await expect(pinnedBody).toHaveAttribute("aria-current", "page");
  await expect(stepName).toHaveValue(review.label);
  await expect(stepName).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Review question", exact: true })).toHaveValue(
    review.instructions,
  );
  await back.press("Enter");
  await expect(stepName).toHaveValue("Find the cross-asset tension");
  await expect(undo).toBeDisabled();

  await page.getByRole("combobox", { name: "Next step", exact: true }).selectOption("");
  await disclosure.click();
  await expect(plan).toHaveCount(0);
  await expect(
    page.getByText("No review steps are reachable from the workflow start."),
  ).toBeVisible();
  await undo.click();
  await expect(rows).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
