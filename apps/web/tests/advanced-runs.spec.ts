import { expect, test } from "@playwright/test";
import example from "../../../examples/advanced-workflow.json";

async function openWorkflow(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  workflow: unknown,
) {
  const response = await request.post("/api/revisions", { data: workflow });
  expect(response.status()).toBe(201);
  await page.goto(`/?revision=${(await response.json()).id}`);
  await expect(page.getByRole("button", { name: "Run workflow" })).toBeEnabled();
  await page.getByRole("button", { name: "Run workflow" }).click();
  await page.getByRole("button", { name: "Start run", exact: true }).click();
}

test("nested reviews show the iteration, survive refresh, and finish", async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1040 });
  await openWorkflow(page, request, example);
  const inspector = page.getByRole("region", { name: "Run inspector" });
  await expect(page.getByRole("heading", { name: "Run paused" })).toBeVisible();
  await expect(inspector).toContainText("root › review_loop › iteration-1 › review");
  await page.getByRole("button", { name: "Approve and continue" }).click();
  await expect(inspector).toContainText("root › review_loop › iteration-2 › review");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Run paused" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("nested-review-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Approve and continue" }).click();
  await expect(page.getByRole("heading", { name: "Run completed" })).toBeVisible();
  await expect(inspector).toContainText("Exit condition satisfied.");
  expect(errors).toEqual([]);
});

test("cancel a paused nested run and retain the outcome after refresh", async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkflow(page, request, example);
  await expect(page.getByRole("heading", { name: "Run paused" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel run", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Run cancelled" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve and continue" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Run cancelled" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("cancelled-mobile.png"), fullPage: true });
});

test("budget exhaustion is visible and cannot be resumed", async ({ page, request }) => {
  await openWorkflow(page, request, { ...example, budgets: { max_node_executions: 2 } });
  await expect(page.getByRole("heading", { name: "Run limited" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Run inspector" })).toContainText(
    "Node execution limit reached.",
  );
  await expect(page.getByRole("button", { name: "Recover run", exact: true })).toHaveCount(0);
});

test("parallel reviews have independent decisions", async ({ page, request }) => {
  const workflow = structuredClone(example);
  workflow.nodes[1]!.kind = "review";
  workflow.nodes[2]!.kind = "review";
  await openWorkflow(page, request, workflow);
  await expect(page.getByRole("button", { name: "Approve and continue" })).toHaveCount(2);
  await page
    .locator('[aria-label="Review challenge"]')
    .getByRole("button", { name: "Approve and continue" })
    .click();
  await expect(page.getByRole("button", { name: "Approve and continue" })).toHaveCount(1);
  await expect(page.locator('[aria-label="Review support"]')).toBeVisible();
  await page.getByRole("button", { name: "Cancel run", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Run cancelled" })).toBeVisible();
});
