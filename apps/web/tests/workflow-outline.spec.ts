import advanced from "../../../examples/advanced-workflow.json";
import { addTemplate, insertStep } from "../src/lib/workflow-editing";
import type { Workflow } from "../src/lib/workflow";
import { expect, test } from "./fixtures";

test("browse connected branches and exact pinned loop callers from Build", async ({
  page,
  request,
}) => {
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
  const saved = await request.post("/api/revisions", { data: draft });
  expect(saved.status(), await saved.text()).toBe(201);
  const revision = await saved.json();
  await page.setViewportSize({ width: 390, height: 950 });
  await page.goto(`/?revision=${revision.id}`);

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
