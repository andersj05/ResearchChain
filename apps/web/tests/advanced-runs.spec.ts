import { expect, test } from "./fixtures";
import legacy from "../../../examples/research-workflow.json";
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
  await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Needs review");
  await expect(inspector).toContainText("root › review_loop › iteration-1 › review");
  await page.getByRole("button", { name: "Approve and continue" }).click();
  await expect(inspector).toContainText("root › review_loop › iteration-2 › review");
  await page.reload();
  await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Needs review");
  await page.screenshot({ path: testInfo.outputPath("nested-review-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Approve and continue" }).click();
  await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Completed");
  await page.getByRole("combobox", { name: "Inspect step" }).selectOption("root/review_loop");
  await expect(inspector).toContainText("Exit condition satisfied.");
  const runId = new URL(page.url()).searchParams.get("run");
  const pinned = await (await request.get(`/api/runs/${runId}`)).json();
  await inspector.getByRole("button", { name: "Iteration 2", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Inspect step" })).toHaveValue(
    "root/review_loop/iteration-2/review",
  );
  await inspector.getByRole("button", { name: "Iterate from this step", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Build", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const crumbs = page.getByRole("navigation", { name: "Graph breadcrumbs" });
  await expect(crumbs.getByRole("button", { name: "Critique and review v1" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
  await expect(stepName).toHaveValue("Review");
  await stepName.fill("Synthetic revised checkpoint");
  await expect(page.locator(".save-state")).toHaveClass(/unsaved/);
  const saved = await (await request.get(`/api/runs/${runId}`)).json();
  expect(saved.workflow).toEqual(pinned.workflow);
  expect(saved.events).toEqual(pinned.events);
  expect(errors).toEqual([]);
});

test("cancel a paused nested run and retain the outcome after refresh", async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkflow(page, request, example);
  await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Needs review");
  await page.getByRole("button", { name: "Cancel run", exact: true }).click();
  await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Cancelled");
  await expect(page.getByRole("button", { name: "Approve and continue" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Cancelled");
  await page.screenshot({ path: testInfo.outputPath("cancelled-mobile.png"), fullPage: true });
});

test("budget exhaustion is visible and cannot be resumed", async ({ page, request }) => {
  await openWorkflow(page, request, { ...example, budgets: { max_node_executions: 2 } });
  await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Limit reached");
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
  const reviews = page.getByRole("combobox", { name: "Pending reviews" });
  await expect(reviews.locator("option:enabled")).toHaveCount(2);
  await reviews.selectOption("root/challenge");
  await page
    .locator('[aria-label="Review challenge"]')
    .getByRole("button", { name: "Approve and continue" })
    .click();
  await expect(page.getByRole("button", { name: "Approve and continue" })).toHaveCount(1);
  await expect(page.locator('[aria-label="Review support"]')).toBeVisible();
  await page.getByRole("button", { name: "Cancel run", exact: true }).click();
  await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Cancelled");
});

test("saving a new step normalizes default ports without leaving a dirty draft", async ({
  page,
  request,
}) => {
  const revision = await (await request.post("/api/revisions", { data: legacy })).json();
  await page.goto(`/?revision=${revision.id}`);
  await expect(page.getByRole("button", { name: "Add research note", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Add research note", exact: true }).click();
  await page.getByRole("textbox", { name: "Step name", exact: true }).fill("Normalized note");
  await page.getByRole("button", { name: "Save revision", exact: true }).click();
  await expect(page.locator(".save-state")).toHaveText(/Revision \d+/);
  await expect(page.locator(".save-state")).not.toHaveClass(/unsaved/);
});
