import { expect, test, type APIRequestContext } from "./fixtures";
import type { components } from "@researchchain/contracts";

type Snapshot = components["schemas"]["UsageSnapshot"];
type Policy = Snapshot["policy"];

async function current(request: APIRequestContext): Promise<Snapshot> {
  const response = await request.get("/api/usage");
  expect(response.status()).toBe(200);
  return response.json();
}

async function restore(request: APIRequestContext, policy: Policy) {
  const latest = await current(request);
  const response = await request.post("/api/usage/policy", {
    data: {
      expected_revision: latest.policy.revision,
      max_requests_24h: policy.max_requests_24h,
      paused: policy.paused,
    },
  });
  expect(response.status()).toBe(200);
}

for (const width of [1440, 390]) {
  test(`owner saves and restores the real request allowance at ${width}px`, async ({
    page,
    request,
  }, info) => {
    const before = await current(request);
    try {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/?view=operations");
      const panel = page.getByRole("region", { name: "Request allowance", exact: true });
      const maximum = panel.getByLabel("Requests per 24 hours", { exact: true });
      const save = panel.getByRole("button", { name: "Save request limits", exact: true });
      await expect(maximum).toHaveValue(String(before.policy.max_requests_24h));
      await maximum.fill("0");
      await expect(save).toBeDisabled();
      await maximum.fill("10001");
      await expect(save).toBeDisabled();
      await maximum.fill("42");
      await panel.getByLabel("Pause new model requests", { exact: true }).check();
      await save.click();
      await expect(panel.getByRole("status")).toHaveText("New model requests are paused.");
      await expect(panel.getByText("Paused", { exact: true })).toBeVisible();
      const changed = await current(request);
      expect(changed.policy.max_requests_24h).toBe(42);
      expect(changed.policy.paused).toBe(true);
      expect(changed.admitted_requests_24h).toBe(before.admitted_requests_24h);
      await page.reload();
      await expect(maximum).toHaveValue("42");
      await expect(panel.getByLabel("Pause new model requests", { exact: true })).toBeChecked();
      await expect(save).toBeDisabled();
      await panel.screenshot({ path: info.outputPath(`request-allowance-${width}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    } finally {
      await restore(request, before.policy);
    }
  });
}

test("stale policy edits preserve the draft and require loading current limits", async ({
  page,
  request,
}) => {
  const before = await current(request);
  try {
    await page.goto("/?view=operations");
    const panel = page.getByRole("region", { name: "Request allowance", exact: true });
    const maximum = panel.getByLabel("Requests per 24 hours", { exact: true });
    const save = panel.getByRole("button", { name: "Save request limits", exact: true });
    await expect(maximum).toHaveValue(String(before.policy.max_requests_24h));
    await maximum.fill("77");
    expect(
      (
        await request.post("/api/usage/policy", {
          data: { expected_revision: before.policy.revision, max_requests_24h: 84, paused: false },
        })
      ).status(),
    ).toBe(200);
    await save.click();
    await expect(panel.getByRole("alert")).toContainText("changed elsewhere");
    await expect(save).toBeDisabled();
    await panel.getByRole("button", { name: "Refresh allowance", exact: true }).click();
    await expect(panel.getByText(/Saved limits changed while you were editing/)).toBeVisible();
    await expect(maximum).toHaveValue("77");
    await expect(save).toBeDisabled();
    await panel.getByRole("button", { name: "Load saved limits", exact: true }).click();
    await expect(maximum).toHaveValue("84");
    await maximum.fill("85");
    await save.click();
    await expect(panel.getByRole("status")).toHaveText("Request limits saved.");
    expect((await current(request)).policy.max_requests_24h).toBe(85);
  } finally {
    await restore(request, before.policy);
  }
});

test("a lost save response is read back without replaying the mutation", async ({
  page,
  request,
}) => {
  const before = await current(request);
  let writes = 0;
  try {
    await page.route("**/api/usage/policy", async (route) => {
      writes++;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("connectionreset");
    });
    await page.goto("/?view=operations");
    const panel = page.getByRole("region", { name: "Request allowance", exact: true });
    const maximum = panel.getByLabel("Requests per 24 hours", { exact: true });
    const save = panel.getByRole("button", { name: "Save request limits", exact: true });
    await expect(maximum).toBeEnabled();
    await maximum.fill("57");
    await save.click();
    await expect(panel.getByRole("alert")).toContainText("save could not be confirmed");
    await expect(save).toBeDisabled();
    expect(writes).toBe(1);
    await panel.getByRole("button", { name: "Refresh allowance", exact: true }).click();
    await expect(panel.getByText(/Saved limits changed while you were editing/)).toBeVisible();
    await expect(save).toBeDisabled();
    await panel.getByRole("button", { name: "Load saved limits", exact: true }).click();
    await expect(maximum).toHaveValue("57");
    await page.reload();
    await expect(maximum).toHaveValue("57");
    expect(writes).toBe(1);
    expect((await current(request)).admitted_requests_24h).toBe(before.admitted_requests_24h);
  } finally {
    await restore(request, before.policy);
  }
});

test("failed reads keep the prior snapshot visible and block edits until a fresh read", async ({
  page,
}) => {
  let fail = false;
  let writes = 0;
  await page.route("**/api/usage", async (route) => {
    if (fail) await route.fulfill({ status: 503, json: { detail: "Synthetic outage" } });
    else await route.continue();
  });
  await page.route("**/api/usage/policy", async (route) => {
    writes++;
    await route.continue();
  });
  await page.goto("/?view=operations");
  const panel = page.getByRole("region", { name: "Request allowance", exact: true });
  const maximum = panel.getByLabel("Requests per 24 hours", { exact: true });
  const save = panel.getByRole("button", { name: "Save request limits", exact: true });
  await expect(maximum).toBeEnabled();
  await maximum.fill("53");
  fail = true;
  await panel.getByRole("button", { name: "Refresh allowance", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("unavailable");
  await expect(panel.getByText(/previous snapshot is still shown/)).toBeVisible();
  await expect(maximum).toHaveValue("53");
  await expect(save).toBeDisabled();
  fail = false;
  await panel.getByRole("button", { name: "Refresh allowance", exact: true }).click();
  await expect(save).toBeEnabled();
  expect(writes).toBe(0);
});

test("an expired owner session never replays a policy save after sign-in", async ({
  page,
  request,
}) => {
  const before = await current(request);
  let writes = 0;
  await page.route("**/api/usage/policy", async (route) => {
    writes++;
    await route.continue();
  });
  await page.goto("/?view=operations");
  const panel = page.getByRole("region", { name: "Request allowance", exact: true });
  await expect(panel.getByLabel("Requests per 24 hours", { exact: true })).toBeEnabled();
  await panel.getByLabel("Requests per 24 hours", { exact: true }).fill("63");
  expect((await request.post("/api/access/logout")).status()).toBe(200);
  await panel.getByRole("button", { name: "Save request limits", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in again", exact: true })).toBeVisible();
  await expect(panel).not.toBeVisible();
  await page
    .getByLabel("Owner password", { exact: true })
    .fill(process.env.RESEARCHCHAIN_TEST_OWNER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "Refresh allowance", exact: true })).toBeEnabled();
  expect(writes).toBe(1);
  const after = await page.request.get("/api/usage");
  expect(after.status()).toBe(200);
  expect((await after.json()).policy).toEqual(before.policy);
});
