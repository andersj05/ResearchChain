import { expect, test, type Page, type APIRequestContext } from "./fixtures";
import { holdWorkers } from "./worker-fixture";
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
      await expect(page.getByRole("heading", { name: "Run queued", exact: true })).toBeVisible();
      const id = new URL(page.url()).searchParams.get("run");
      await expect(page.getByRole("heading", { name: "Waiting to start" })).toBeVisible();
      expect((await (await request.get(`/api/runs/${id}`)).json()).usage.node_executions).toBe(0);
      await page.screenshot({ path: testInfo.outputPath("queued-run.png"), fullPage: true });
      await page.reload();
      await expect(page.getByRole("heading", { name: "Run queued", exact: true })).toBeVisible();
      expect(new URL(page.url()).searchParams.get("run")).toBe(id);
      await release();
      await expect(page.getByRole("heading", { name: "Run paused", exact: true })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Run queued", exact: true })).toBeVisible();
    const id = new URL(page.url()).searchParams.get("run");
    await page.getByRole("button", { name: "Cancel run", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Run cancelled", exact: true })).toBeVisible();
    await release();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Run cancelled", exact: true })).toBeVisible();
    const cancelled = await (await request.get(`/api/runs/${id}`)).json();
    expect(cancelled.events).toEqual([]);
    expect(cancelled.usage.node_executions).toBe(0);
  } finally {
    await release();
  }
});

test("refresh after an unconfirmed start retains the same request identity", async ({
  page,
  request,
  ownerSession,
}) => {
  await openSetup(page, request);
  let firstId: string | undefined;
  let retryId: string | undefined;
  await page.route("**/api/runs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON();
    if (!firstId) {
      firstId = body.id;
      return route.abort("failed");
    }
    retryId = body.id;
    return route.continue();
  });
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect.poll(() => firstId).toBeTruthy();
  await expect(page.getByRole("button", { name: "Run workflow", exact: true })).toBeEnabled();
  const key = ownerSession.prefix + ".run.pending";
  expect(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!).id, key)).toBe(
    firstId,
  );
  await page.reload();
  await page.getByRole("tab", { name: "Build", exact: true }).click();
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Run paused", exact: true })).toBeVisible();
  expect(retryId).toBe(firstId);
  expect(new URL(page.url()).searchParams.get("run")).toBe(firstId);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), key)).toBeNull();
});
