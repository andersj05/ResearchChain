import { expect, test } from "@playwright/test";

test("edit, save, validate, run, and resume an immutable workflow", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Instructions", exact: true })
    .fill("Compare competing explanations.");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved in this browser.");
  await page.getByRole("button", { name: "Validate workflow", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Workflow valid. Ready to run.");
  await page.getByRole("button", { name: "Run workflow" }).click();
  await expect(page.getByRole("heading", { name: "Run paused" })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Instructions", exact: true })
    .fill("Only for the next run.");
  await expect(page.getByLabel("Run inspector")).toContainText("Compare competing explanations.");
  await page.getByRole("button", { name: "Approve and continue" }).click();
  await expect(page.getByRole("heading", { name: "Run completed" })).toBeVisible();
  await page.getByRole("button", { name: "Load saved draft" }).click();
  await expect(page.getByRole("textbox", { name: "Instructions", exact: true })).toHaveValue(
    "Compare competing explanations.",
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("researchchain-workflow.json");
  expect(browserErrors).toEqual([]);
});

test("invalid connections show a useful error and remain editable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Next node", exact: true }).selectOption("");
  await page.getByRole("button", { name: "Validate workflow", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "connected chain" })).toBeVisible();
  await page.getByRole("button", { name: "Undo last edit" }).click();
  await expect(page.getByRole("combobox", { name: "Next node", exact: true })).toHaveValue(
    "challenge",
  );
});

test("canvas nodes can be moved with the keyboard", async ({ page }) => {
  await page.goto("/");
  const node = page.getByRole("button", { name: "Edit Frame the question", exact: true });
  await node.focus();
  await node.press("Alt+ArrowRight");
  await expect(node).toHaveCSS("left", "70px");
});

test("workbench fits a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
});
