import { expect, test } from "./fixtures";
import workflow from "../../../examples/advanced-workflow.json";
import macro from "../../../examples/discretionary-macro.json";

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
