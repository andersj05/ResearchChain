import { expect, test, type APIRequestContext, type Page } from "./fixtures";
import workflow from "../../../examples/research-workflow.json";

test.describe.configure({ mode: "default" });

async function seedTerminal(request: APIRequestContext) {
  const revision = await request.post("/api/revisions", {
    data: { ...workflow, name: `Synthetic cleanup ${crypto.randomUUID()}` },
  });
  expect(revision.status()).toBe(201);
  const id = crypto.randomUUID();
  expect(
    (
      await request.post("/api/runs", {
        data: { id, revision_id: (await revision.json()).id, brief: "Synthetic cleanup case" },
      })
    ).status(),
  ).toBe(202);
  await expect
    .poll(async () => (await (await request.get(`/api/runs/${id}`)).json()).status, {
      timeout: 30000,
    })
    .toBe("paused");
  expect((await request.post(`/api/runs/${id}/cancel`)).status()).toBe(200);
  return id;
}

async function openPreview(page: Page) {
  await page.goto("/?view=operations");
  const panel = page.getByRole("region", { name: "Run cleanup", exact: true });
  await expect(panel.getByRole("button", { name: "Preview cleanup", exact: true })).toBeEnabled();
  await panel.getByLabel("Runs created before").selectOption("0");
  await panel.getByLabel("Maximum runs").selectOption("10");
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/retention/previews") && response.request().method() === "POST",
  );
  await panel.getByRole("button", { name: "Preview cleanup", exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(201);
  return { panel, record: await response.json() };
}

for (const width of [1440, 390]) {
  test(`reviewed cleanup deletes only its selection at ${width}px`, async ({
    page,
    request,
  }, info) => {
    test.setTimeout(90000);
    await Promise.all(Array.from({ length: width === 1440 ? 10 : 1 }, () => seedTerminal(request)));
    await page.setViewportSize({ width, height: 1000 });
    const { panel, record } = await openPreview(page);
    expect(record.runs.length).toBeGreaterThan(0);
    await expect(panel.getByRole("heading", { name: "Review cleanup" })).toBeVisible();
    const remove = panel.getByRole("button", { name: "Permanently delete selected runs" });
    await expect(remove).toBeDisabled();
    await panel.getByLabel("Type DELETE to confirm this selection").fill("delete");
    await expect(remove).toBeDisabled();
    await panel.getByLabel("Type DELETE to confirm this selection").fill("DELETE");
    await expect(remove).toBeEnabled();
    // The panel sits in a scrolling workbench. Give an element screenshot enough
    // viewport height; Playwright's automatic resize can otherwise capture its
    // scroll ancestor instead of the full reviewed selection.
    const panelHeight = await panel.evaluate((element) => element.getBoundingClientRect().height);
    await page.setViewportSize({ width, height: Math.ceil(panelHeight) + 180 });
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: info.outputPath(`cleanup-review-${width}.png`) });
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await remove.click();
    await expect(panel.getByRole("heading", { name: "Cleanup complete" })).toBeVisible();
    for (const run of record.runs) {
      expect((await request.get(`/api/runs/${run.run_id}`)).status()).toBe(410);
    }
    const receipt = (await (await request.get(`/api/retention/previews/${record.id}`)).json())
      .receipt;
    const retry = await request.post(`/api/retention/previews/${record.id}/apply`, {
      data: { digest: record.digest, confirmation: "DELETE" },
    });
    expect(retry.status()).toBe(200);
    expect(await retry.json()).toEqual(receipt);
    await page.reload();
    await expect(panel.getByRole("heading", { name: "Cleanup complete" })).toBeVisible();
    await panel.getByRole("button", { name: "View cleanup receipts" }).click();
    await expect(panel.getByRole("heading", { name: "Recent cleanup receipts" })).toBeVisible();
  });
}

test("an unconfirmed preview keeps its request identity through retry and refresh", async ({
  page,
  ownerSession,
}) => {
  const ids: string[] = [];
  await page.route("**/api/retention/previews", async (route) => {
    ids.push(route.request().postDataJSON().id);
    if (ids.length === 1) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.goto("/?view=operations");
  const panel = page.getByRole("region", { name: "Run cleanup", exact: true });
  await panel.getByRole("button", { name: "Preview cleanup", exact: true }).click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await panel.getByRole("button", { name: "Retry preview", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Review cleanup" })).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    ownerSession.prefix + ".retention",
  );
  expect(saved.request.id).toBe(ids[0]);
  expect(Object.keys(saved).sort()).toEqual(["applying", "request"]);
  await page.reload();
  await expect(panel.getByRole("heading", { name: "Review cleanup" })).toBeVisible();
  expect(ids).toHaveLength(2);
  await panel.getByRole("button", { name: "Discard preview" }).click();
  await expect(panel.getByRole("button", { name: "Preview cleanup", exact: true })).toBeEnabled();
});

test("refresh recovers a lost cleanup receipt without repeating deletion", async ({
  page,
  request,
}) => {
  await seedTerminal(request);
  const { panel, record } = await openPreview(page);
  let submissions = 0;
  await page.route(`**/api/retention/previews/${record.id}/apply`, async (route) => {
    submissions++;
    const result = await route.fetch();
    expect(result.status()).toBe(200);
    await route.abort("failed");
  });
  await panel.getByLabel("Type DELETE to confirm this selection").fill("DELETE");
  await panel.getByRole("button", { name: "Permanently delete selected runs" }).click();
  await expect(panel.getByText(/The result is not confirmed/)).toBeVisible();
  expect(submissions).toBe(1);
  await page.reload();
  await expect(panel.getByRole("heading", { name: "Cleanup complete" })).toBeVisible();
  expect(submissions).toBe(1);
});

test("changed dependencies require a new preview and discard never submits deletion", async ({
  page,
  request,
}) => {
  const id = await seedTerminal(request);
  const { panel, record } = await openPreview(page);
  let submissions = 0;
  await page.route(`**/api/retention/previews/${record.id}/apply`, async (route) => {
    submissions++;
    await route.fulfill({
      status: 409,
      json: {
        detail: "A selected run changed or is protected. Create a new preview.",
      },
    });
  });
  await panel.getByLabel("Type DELETE to confirm this selection").fill("DELETE");
  await panel.getByRole("button", { name: "Permanently delete selected runs" }).click();
  await expect(panel.getByRole("alert")).toContainText("Create a new preview");
  await expect(
    panel.getByRole("button", { name: "Permanently delete selected runs" }),
  ).toBeDisabled();
  await panel.getByRole("button", { name: "Discard preview" }).click();
  await expect(panel.getByRole("button", { name: "Preview cleanup", exact: true })).toBeEnabled();
  expect(submissions).toBe(1);
  expect((await request.get(`/api/runs/${id}`)).status()).toBe(200);
});

test("cleanup returns to owner sign-in after session revocation", async ({ page, request }) => {
  await page.goto("/?view=operations");
  const panel = page.getByRole("region", { name: "Run cleanup", exact: true });
  await expect(panel.getByRole("button", { name: "Preview cleanup", exact: true })).toBeEnabled();
  expect((await request.post("/api/access/logout")).status()).toBe(200);
  await panel.getByRole("button", { name: "Preview cleanup", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in again", exact: true })).toBeVisible();
  await expect(panel).not.toBeVisible();
});
