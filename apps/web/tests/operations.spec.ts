import { expect, test } from "./fixtures";
import type { components } from "@researchchain/contracts";

type Snapshot = components["schemas"]["OperationsSnapshot"];

const observed: Snapshot = {
  observed_at: "2026-11-15T10:00:00Z",
  window_started_at: "2026-11-14T10:00:00Z",
  workers: { connected_consumers: 2, max_parallel: 2, max_pending: 100, reserved_slots: 1 },
  queue: {
    queued: 3,
    executing: 1,
    awaiting_takeover: 1,
    interrupted: 2,
    finished_24h: 9,
    oldest_pending_seconds: 125,
  },
  storage: {
    runs: 12,
    evidence_records: 8,
    report_revisions: 4,
    evaluation_datasets: 2,
    originals: 6,
    original_bytes: 8192,
    schema_bytes: 1048576,
  },
  usage: {
    attempts_started_24h: 3,
    reported_input_tokens_24h: 1200,
    reported_output_tokens_24h: 400,
    incomplete_usage_24h: 1,
    uncertain_attempts: 1,
  },
};

for (const width of [1440, 390]) {
  test(`operations shows status and preserves the selected view at ${width}px`, async ({
    page,
    request,
  }, info) => {
    // The actual owner-protected endpoint is exercised before deterministic UI states.
    const response = await request.get("/api/operations");
    expect(response.status()).toBe(200);
    const live = await response.json();
    expect(live.workers.connected_consumers).toBeGreaterThan(0);
    expect(live.storage.schema_bytes).toBeGreaterThan(0);
    let reads = 0;
    await page.route("**/api/operations", async (route) => {
      reads++;
      await route.fulfill({ json: observed });
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/?view=operations");
    await expect(page.getByRole("heading", { name: "Operations", exact: true })).toBeVisible();
    const queue = page.getByRole("region", { name: "Queue", exact: true });
    await expect(queue.getByText("2 min", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Stored data" }).getByText("8.0 KiB"),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Model usage" }).getByText("1,200"),
    ).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Needs attention" })).toBeVisible();
    const initialReads = reads;
    expect(initialReads).toBeGreaterThan(0);
    // Advancing the browser's poll timers must not issue background status reads.
    await page.clock.install();
    await page.clock.fastForward(35000);
    expect(reads).toBe(initialReads);
    await page.getByRole("button", { name: "Refresh status", exact: true }).click();
    await expect.poll(() => reads).toBe(initialReads + 1);
    await expect(page.getByRole("button", { name: "Refresh status", exact: true })).toBeEnabled();
    await page.screenshot({ path: info.outputPath(`operations-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.reload();
    await expect(page.getByRole("heading", { name: "Operations", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open runs", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Runs", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(new URL(page.url()).searchParams.get("view")).toBe("runs");
  });
}

test("operations keeps a failed refresh clearly stale and allows recovery", async ({ page }) => {
  let fail = false;
  let current = observed;
  await page.route("**/api/operations", async (route) => {
    await route.fulfill(
      fail ? { status: 503, json: { detail: "Synthetic database outage" } } : { json: current },
    );
  });
  await page.goto("/?view=operations");
  await expect(page.getByRole("button", { name: "Refresh status", exact: true })).toBeEnabled();
  fail = true;
  await page.getByRole("button", { name: "Refresh status", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Workspace operations" }).getByRole("alert"),
  ).toContainText("The previous snapshot is still shown.");
  await expect(
    page.getByRole("region", { name: "Queue", exact: true }).getByText("2 min"),
  ).toBeVisible();
  fail = false;
  current = { ...observed, workers: { ...observed.workers, connected_consumers: 0 } };
  await page.getByRole("button", { name: "Refresh status", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Workspace operations" }).getByRole("alert"),
  ).toHaveCount(0);
  await expect(page.getByText(/No workers connected/)).toBeVisible();
});

test("operations refresh returns to owner sign-in after session revocation", async ({
  page,
  request,
}) => {
  await page.goto("/?view=operations");
  await expect(page.getByRole("button", { name: "Refresh status", exact: true })).toBeEnabled();
  expect((await request.post("/api/access/logout")).status()).toBe(200);
  await page.getByRole("button", { name: "Refresh status", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in again", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Workspace operations" })).not.toBeVisible();
  expect((await request.get("/api/operations")).status()).toBe(401);
});
