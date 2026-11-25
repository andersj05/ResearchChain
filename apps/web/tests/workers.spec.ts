import { expect, test, type Page, type APIRequestContext } from "./fixtures";
import { holdWorkers } from "./worker-fixture";
import type { RunRequest } from "../src/lib/workflow";
import workflow from "../../../examples/research-workflow.json";

test.describe.configure({ mode: "default" });

async function openSetup(page: Page, request: APIRequestContext) {
  const saved = await request.post("/api/revisions", {
    data: { ...workflow, name: `Worker fixture ${crypto.randomUUID()}` },
  });
  expect(saved.status()).toBe(201);
  await page.goto(`/?revision=${(await saved.json()).id}`);
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
}

for (const width of [1440, 390]) {
  test(`queued work survives refresh and starts when capacity returns at ${width}px`, async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const release = await holdWorkers();
    try {
      await openSetup(page, request);
      await page.getByRole("button", { name: "Start run", exact: true }).click();
      await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Queued");
      const id = new URL(page.url()).searchParams.get("run");
      await expect(page.getByText("Waiting to start", { exact: true })).toBeVisible();
      expect((await (await request.get(`/api/runs/${id}`)).json()).usage.node_executions).toBe(0);
      await page.screenshot({ path: testInfo.outputPath("queued-run.png"), fullPage: true });
      await page.reload();
      await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Queued");
      expect(new URL(page.url()).searchParams.get("run")).toBe(id);
      await release();
      await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Needs review");
      expect((await (await request.get(`/api/runs/${id}`)).json()).events).toHaveLength(2);
    } finally {
      await release();
    }
  });
}

test("cancel queued work before a worker can execute it", async ({ page, request }) => {
  const release = await holdWorkers();
  try {
    await openSetup(page, request);
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Queued");
    const id = new URL(page.url()).searchParams.get("run");
    await page.getByRole("button", { name: "Cancel run", exact: true }).click();
    await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Cancelled");
    await release();
    await page.reload();
    await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Cancelled");
    const cancelled = await (await request.get(`/api/runs/${id}`)).json();
    expect(cancelled.events).toEqual([]);
    expect(cancelled.usage.node_executions).toBe(0);
  } finally {
    await release();
  }
});

test("an unconfirmed start reopens the exact setup before and after refresh at 390px", async ({
  page,
  request,
  ownerSession,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSetup(page, request);
  const dialog = page.getByRole("dialog", { name: "Start a research run" });
  const briefInput = dialog.getByRole("textbox", { name: "Research brief" });
  const start = dialog.getByRole("button", { name: "Start run", exact: true });
  const returnToSetup = page.getByRole("button", { name: "Return to run setup" });
  const submittedBrief = "Compare the synthetic peers in the November dataset.";
  await briefInput.fill(submittedBrief);
  const attempts: RunRequest[] = [];
  await page.route("**/api/runs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    attempts.push(route.request().postDataJSON());
    if (attempts.length === 1) return route.abort("failed");
    return route.continue();
  });
  const missingRun = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.status() === 404 &&
      new URL(response.url()).pathname === `/api/runs/${attempts[0]?.id}`,
  );
  await start.click();
  await missingRun;
  await expect(returnToSetup).toBeInViewport();
  await expect(page.getByRole("status", { name: "Workspace status" })).toContainText(
    "Run start is unconfirmed",
  );
  const pending = attempts[0]!;
  const runs = page.getByRole("tab", { name: "Runs", exact: true });
  await returnToSetup.click();
  await expect(briefInput).toBeFocused();
  await expect(briefInput).toHaveValue(submittedBrief);
  const newerBrief = "Compare the synthetic peers using the latest release.";
  await briefInput.fill(newerBrief);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await runs.click();
  await returnToSetup.click();
  await expect(briefInput).toBeFocused();
  await expect(briefInput).toHaveValue(newerBrief);
  expect(attempts).toEqual([pending]);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await runs.click();
  const key = ownerSession.prefix + ".run.pending";
  expect(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), key)).toEqual(
    pending,
  );
  await page.reload();
  await expect(returnToSetup).toBeInViewport();
  const pendingUrl = page.url();
  expect(new URL(pendingUrl).searchParams.get("run")).toBe(pending.id);
  const unrelatedRun = new URL(pendingUrl);
  unrelatedRun.searchParams.set("run", crypto.randomUUID());
  await page.goto(unrelatedRun.toString());
  await expect(page.getByRole("alert").filter({ hasText: "The draft is editable." })).toBeVisible();
  await expect(returnToSetup).toHaveCount(0);

  await page.goto(pendingUrl);
  await returnToSetup.click();
  await expect(briefInput).toBeFocused();
  await expect(briefInput).toHaveValue(submittedBrief);
  expect(attempts).toEqual([pending]);
  await start.click();
  await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Needs review");
  expect(attempts).toEqual([pending, pending]);
  expect(new URL(page.url()).searchParams.get("run")).toBe(pending.id);
  await expect(returnToSetup).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), key)).toBeNull();
});
