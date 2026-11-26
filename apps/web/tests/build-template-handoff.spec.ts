import { expect, test } from "./fixtures";
import demo from "../../../examples/research-workflow.json";

const stagedStep = "Unsaved synthetic opening note";
const templates = [
  {
    action: "Use no-model demo",
    notice: "Demo loaded. Notes do not call a model.",
    start: "Frame the question",
  },
  {
    action: "Use research template",
    notice: "Research template loaded.",
    start: "Form hypotheses",
  },
  {
    action: "Use idea research example",
    notice: "Idea research example loaded.",
    start: "Frame my idea",
  },
];

test.beforeEach(async ({ page, request }) => {
  const saved = await request.post("/api/revisions", { data: demo });
  expect(saved.status()).toBe(201);
  await page.goto(`/?revision=${(await saved.json()).id}`);
  const step = page.getByRole("textbox", { name: "Step name", exact: true });
  await expect(step).toHaveValue("Frame the question");
  await step.fill(stagedStep);
});

for (const width of [320, 390]) {
  test(`opens the template canvas and offers exact Undo at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const status = page.getByRole("status", { name: "Workspace status", exact: true });
    const step = page.getByRole("textbox", { name: "Step name", exact: true });
    const undoTemplate = page.getByRole("button", { name: "Undo template load", exact: true });
    const canvas = page.locator('[aria-label="Workflow canvas"]');
    const mutations: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") mutations.push(new URL(request.url()).pathname);
    });

    for (const template of templates) {
      const button = page.getByRole("button", { name: template.action, exact: true });
      await button.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => scrollY)).toBeGreaterThan(500);
      await button.press("Enter");
      await expect(status).toContainText(template.notice);
      await expect(status).toBeFocused();
      await expect(status).toBeInViewport({ ratio: 1 });
      await expect(canvas).toBeInViewport({ ratio: 0.75 });
      await expect(step).toHaveValue(template.start);
      await expect(undoTemplate).toBeInViewport({ ratio: 1 });
      await page.keyboard.press("Tab");
      await expect(undoTemplate).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(step).toHaveValue(stagedStep);
      await expect(status).toHaveText("Previous workflow restored.");
      await expect(status).toBeFocused();
      await expect(undoTemplate).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(mutations).toEqual([]);
  });
}

test("offers Undo only for the exact just-loaded template edit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const research = page.getByRole("button", { name: "Use research template", exact: true });
  const contextualUndo = page.getByRole("button", { name: "Undo template load", exact: true });
  const ordinaryUndo = page.getByRole("button", { name: "Undo last edit", exact: true });
  const step = page.getByRole("textbox", { name: "Step name", exact: true });

  await research.click();
  await expect(contextualUndo).toBeVisible();
  await step.fill("Later edit to the loaded template");
  await expect(contextualUndo).toHaveCount(0);
  await ordinaryUndo.click();
  await expect(step).toHaveValue("Form hypotheses");
  await expect(contextualUndo).toHaveCount(0);

  await research.click();
  await expect(contextualUndo).toHaveCount(0);
  await ordinaryUndo.click();
  await expect(step).toHaveValue(stagedStep);
});

test("keeps desktop template browsing and Undo in the footer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1040 });
  const status = page.getByRole("status", { name: "Workspace status", exact: true });
  const step = page.getByRole("textbox", { name: "Step name", exact: true });
  const nextTemplate = page.getByRole("button", { name: "Use research template", exact: true });
  const firstTemplate = page.getByRole("button", { name: "Use no-model demo", exact: true });
  await firstTemplate.press("Enter");
  await expect(firstTemplate).toBeFocused();
  await expect(status).toContainText("Demo loaded.");
  await expect(step).toHaveValue("Frame the question");
  await page.keyboard.press("Tab");
  await expect(nextTemplate).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(nextTemplate).toBeFocused();
  await expect(status).toContainText("Research template loaded.");
  await expect(step).toHaveValue("Form hypotheses");
  await expect(page.getByRole("button", { name: "Undo template load", exact: true })).toHaveCount(
    0,
  );
  const undo = page.getByRole("button", { name: "Undo last edit", exact: true });
  await expect(undo).toBeInViewport({ ratio: 1 });
  await undo.click();
  await expect(step).toHaveValue("Frame the question");
  await undo.click();
  await expect(step).toHaveValue(stagedStep);
});
