import advanced from "../../../examples/advanced-workflow.json";
import type { APIRequestContext } from "@playwright/test";
import { addTemplate, insertStep } from "../src/lib/workflow-editing";
import type { Workflow } from "../src/lib/workflow";
import { expect, test } from "./fixtures";

async function saveOutlineFixture(request: APIRequestContext) {
  const { workflow } = addTemplate(
    structuredClone(advanced) as Workflow,
    null,
    "route",
    "support",
    "before",
  );
  const first = workflow.nodes.find((step) => step.id === "review_loop")!;
  const second = { ...structuredClone(first), id: "second_loop", label: "Second review loop" };
  const draft = insertStep(workflow, second, first.id);
  draft.nodes.reverse();
  const body = draft.subgraphs?.find((body) => body.id === "critique");
  const review = body?.nodes.find((step) => step.kind === "review");
  if (review) review.position = { x: 1000, y: 1000 };
  const saved = await request.post("/api/revisions", { data: draft });
  expect(saved.status(), await saved.text()).toBe(201);
  const revision = await saved.json();
  return { draft, revisionId: revision.id as string };
}

test("browse connected branches and exact pinned loop callers from Build", async ({
  page,
  request,
}) => {
  const { draft, revisionId } = await saveOutlineFixture(request);
  await page.setViewportSize({ width: 390, height: 950 });
  await page.goto(`/?revision=${revisionId}`);

  const outline = page.getByRole("list", { name: "Workflow outline", exact: true });
  const support = outline.getByRole("list", { name: "support branch", exact: true });
  const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
  await expect(outline.locator(":scope > li > div > .outline-row .outline-label")).toHaveText([
    "Split",
    "Join",
    "Review_Loop",
    "Second review loop",
    "Finish",
  ]);
  await expect(support.getByRole("list", { name: "If true branch" })).toBeVisible();
  await expect(support.getByRole("list", { name: "If false branch" })).toBeVisible();
  await outline
    .getByRole("button", { name: "Hide branches for Split", exact: true })
    .press("Enter");
  await expect(support).toHaveCount(0);
  await outline
    .getByRole("button", { name: "Show branches for Split", exact: true })
    .press("Enter");
  await expect(support).toBeVisible();

  for (const label of ["Review_Loop", "Second review loop"]) {
    await outline
      .getByRole("button", { name: `Show loop body for ${label}`, exact: true })
      .press("Enter");
  }
  const body = outline.getByRole("group", {
    name: "loop body for Second review loop",
    exact: true,
  });
  await expect(body).toContainText("Critique and review · v1");
  await expect(body).toContainText("Up to 3 iterations");
  await body.getByRole("button", { name: "Stop condition for Second review loop" }).press("Enter");
  await expect(stepName).toHaveValue("Second review loop");
  await expect(page.getByRole("group", { name: "Stop condition", exact: true })).toBeFocused();
  await body.getByRole("button", { name: "Review Review Start", exact: true }).press("Enter");
  await expect(stepName).toHaveValue("Review");
  await expect(stepName).toBeFocused();
  const root = page
    .getByRole("navigation", { name: "Graph breadcrumbs" })
    .getByRole("button", { name: draft.name, exact: true });
  await expect(root).toHaveAccessibleDescription("Return to Second review loop");
  await root.press("Enter");
  await expect(body).toBeVisible();

  await outline.getByRole("button", { name: "Split Parallel Start", exact: true }).click();
  await page.getByRole("combobox", { name: "Next step (support)", exact: true }).selectOption("");
  await expect(outline.getByText("Branch wiring needs attention", { exact: true })).toBeVisible();
  const outside = outline.getByRole("list", { name: "Steps outside the connected outline" });
  await expect(outside.getByRole("button", { name: "Support Note", exact: true })).toBeVisible();
  await expect(outside.getByRole("button", { name: "Finish Finish", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  await expect(outside).toHaveCount(0);
  await expect(support).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

for (const width of [1280, 390]) {
  test(`review a root-based plan and return to the selected nested canvas step at ${width}px`, async ({
    page,
    request,
  }) => {
    const { draft, revisionId } = await saveOutlineFixture(request);
    await page.setViewportSize({ width, height: 950 });
    await page.goto(`/?revision=${revisionId}`);

    const view = page.getByRole("group", { name: "Build view", exact: true });
    const canvasSwitch = view.getByRole("button", { name: "Canvas", exact: true });
    const planSwitch = view.getByRole("button", { name: "Plan", exact: true });
    const canvas = page.getByLabel("Workflow canvas", { exact: true });
    const undo = page.getByRole("button", { name: "Undo last edit", exact: true });
    await expect(canvasSwitch).toHaveAttribute("aria-pressed", "true");
    await expect(planSwitch).toBeEnabled();
    await planSwitch.press("Enter");
    await expect(planSwitch).toHaveAttribute("aria-pressed", "true");
    await expect(canvas).toHaveCount(0);
    await expect(undo).toBeDisabled();

    const outline = page.getByRole("list", { name: "Workflow outline", exact: true });
    const firstBody = outline.getByRole("group", {
      name: "loop body for Review_Loop",
      exact: true,
    });
    const secondBody = outline.getByRole("group", {
      name: "loop body for Second review loop",
      exact: true,
    });
    await outline.getByRole("button", { name: "Show loop body for Review_Loop" }).press("Enter");
    await outline
      .getByRole("button", { name: "Show loop body for Second review loop" })
      .press("Enter");
    await secondBody
      .getByRole("button", { name: "Stop condition for Second review loop" })
      .press("Enter");
    await expect(page.getByRole("group", { name: "Stop condition", exact: true })).toBeFocused();
    const secondReview = secondBody.getByRole("button", {
      name: "Review Review Start",
      exact: true,
    });
    const firstReview = firstBody.getByRole("button", { name: "Review Review Start", exact: true });
    await secondReview.press("Enter");
    const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
    await expect(stepName).toHaveValue("Review");
    await expect(secondReview).toHaveAttribute("aria-pressed", "true");
    await expect(firstReview).toHaveAttribute("aria-pressed", "false");

    const search = page.getByRole("searchbox", { name: "Find a step" });
    await search.fill("review");
    await expect(page.getByRole("list", { name: "Matching steps" })).toBeVisible();
    await search.press("Escape");
    await expect(firstBody).toBeVisible();
    await expect(secondReview).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Collapse all", exact: true }).press("Enter");
    await expect(firstBody).toHaveCount(0);
    await expect(secondReview).toHaveAttribute("aria-pressed", "true");
    await expect(undo).toBeDisabled();

    const inspector = page.getByRole("group", { name: "Node inspector" });
    const question = inspector.getByRole("textbox", { name: "Review question", exact: true });
    await question.fill("Which observation would overturn the lead view?");
    if (width === 390) {
      const returnToOutline = inspector.getByRole("button", { name: "Return to outline" });
      await search.fill("no matching step for this query");
      await returnToOutline.press("Enter");
      await expect(search).toBeFocused();
      await search.press("Escape");
      await returnToOutline.press("Enter");
      await expect(secondReview).toBeFocused();
    }
    await canvasSwitch.press("Enter");
    const canvasReview = canvas.getByRole("button", { name: "Edit Review", exact: true });
    await expect(canvasReview).toBeFocused();
    await expect(canvasReview).toHaveAttribute("aria-pressed", "true");
    await expect(question).toHaveValue("Which observation would overturn the lead view?");
    const root = page
      .getByRole("navigation", { name: "Graph breadcrumbs" })
      .getByRole("button", { name: draft.name, exact: true });
    await expect(root).toHaveAccessibleDescription("Return to Second review loop");
    await planSwitch.press("Enter");
    await expect(secondReview).toHaveAttribute("aria-pressed", "true");
    await expect(firstBody).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
}
