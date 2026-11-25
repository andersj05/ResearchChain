import { initialWorkflow } from "../src/lib/workflow";
import { expect, test, type Page } from "./fixtures";
import { runRequest } from "./run-fixture";

async function holdRevisionHistory(page: Page) {
  const { promise, resolve } = Promise.withResolvers<void>();
  await page.route(
    (url) => url.pathname === "/api/revisions",
    async (route) => {
      await promise;
      await route.continue();
    },
  );
  return resolve;
}

test("direct Reports opens during unrelated startup reads", async ({ page }) => {
  const release = await holdRevisionHistory(page);
  try {
    const pendingHistory = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/api/revisions",
    );
    await page.goto("/?view=reports");
    await pendingHistory;
    await expect(page.getByRole("tab", { name: "Reports", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("button", { name: "Style guides", exact: true })).toBeEnabled();
    await expect(page.locator('[aria-label="Workflow editor"]')).toHaveCount(0);
    await page.getByRole("tab", { name: "Sources", exact: true }).click();
    release();
    await expect(page.getByRole("button", { name: "New agent", exact: true })).toBeEnabled();
    await expect(page.getByRole("tab", { name: "Sources", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("tab", { name: "Build", exact: true }).click();
    await expect(page.getByRole("region", { name: "Workflow editor" })).toBeVisible();
    await page.getByRole("tab", { name: "Reports", exact: true }).click();
    await expect(page.locator('[aria-label="Workflow editor"]')).toHaveCount(1);
    await expect(page.locator('[aria-label="Workflow editor"]')).toBeHidden();
  } finally {
    release();
  }
});

test("a linked run can be read while revision history loads", async ({ page, request }) => {
  const revision = await request.post("/api/revisions", { data: initialWorkflow });
  expect(revision.status()).toBe(201);
  const id = crypto.randomUUID();
  const run = await runRequest(request, "/api/runs", {
    data: { id, revision_id: (await revision.json()).id, brief: "Synthetic saved run" },
  });
  expect(run.status()).toBe(200);
  const release = await holdRevisionHistory(page);
  try {
    await page.goto(`/?view=runs&run=${id}`);
    await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Completed");
    const iterate = page.getByRole("button", { name: "Iterate from this run", exact: true });
    await expect(iterate).toBeDisabled();
    release();
    await expect(iterate).toBeEnabled();
  } finally {
    release();
  }
});
