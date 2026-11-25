import { expect, test } from "./fixtures";

test("compare a revised packet and setup with the saved study only when asked", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const baselineId = crypto.randomUUID();
  const sources = [
    "First observation",
    "Second observation",
    "Third observation",
    "New source",
  ].map((title) => ({
    id: crypto.randomUUID(),
    title,
    kind: "text",
    representation: "original",
    availability: "available",
  }));
  const setup = {
    title: "Previous synthetic study",
    start_from_sources: true,
    brief: "Use the previous horizon.",
    style_excerpt: "State the baseline observation.",
    model: "test-model",
    reasoning_effort: "medium",
    verbosity: "low",
    evidence_ids: sources.slice(0, 3).map(({ id }) => id),
    max_agents: 3,
    max_passes: 6,
    max_active_seconds: 1800,
    max_input_bytes: 8_000_000,
    web_search: false,
    review_mode: "when_needed",
  };
  let setupReads = 0;
  let writes = 0;
  await page.route(`**/api/research-sessions/${baselineId}/setup`, (route) => {
    setupReads += 1;
    return route.fulfill({ json: setup });
  });
  await page.route("**/api/research-sessions", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: [] });
    writes += 1;
    return route.abort();
  });
  await page.route("**/api/evidence?*", (route) =>
    route.fulfill({ json: { items: sources, total: sources.length } }),
  );
  await page.route("**/api/evidence/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    const record = sources.find((item) => item.id === id);
    return record ? route.fulfill({ json: record }) : route.fulfill({ status: 404 });
  });
  await page.route("**/api/providers/chatgpt", (route) =>
    route.fulfill({
      json: {
        accounts: [
          {
            id: "oaiapp_comparison_fixture",
            label: "Synthetic account",
            signed_in: true,
            plan_enabled: true,
            active: true,
          },
        ],
        models: ["test-model", "analysis-model"].map((slug) => ({
          slug,
          display_name: slug,
          reasoning_efforts: ["medium", "high"],
          supports_verbosity: true,
        })),
      },
    }),
  );

  const summary = page.getByText("Compare with previous setup", { exact: true });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "New study", exact: true })).toBeVisible();
  await expect(summary).toHaveCount(0);
  expect(setupReads).toBe(0);

  await page.goto(`/?fromSession=${baselineId}`);
  const context = page.getByLabel("Context for the lead (optional)", { exact: true });
  await expect(context).toHaveValue(setup.brief);
  const initialReads = setupReads;
  expect(initialReads).toBeGreaterThan(0);
  const comparison = page.locator("details").filter({ has: summary });
  await expect(comparison).not.toHaveAttribute("open", "");
  await summary.click();
  await expect(comparison).toContainText("The draft matches the previous setup.");
  expect(setupReads).toBe(initialReads);
  await summary.click();

  const packet = page.getByRole("list", { name: "Pinned material", exact: true });
  await packet.getByRole("button", { name: "Unpin Second observation", exact: true }).click();
  await packet.getByRole("button", { name: "Move Third observation up", exact: true }).click();
  await page.getByRole("checkbox", { name: /New source/ }).check();
  await context.fill("Extend the horizon and check the last reading.");
  await page.getByLabel("Study title (optional)", { exact: true }).fill("Revised synthetic study");
  await page
    .getByLabel("Example report excerpt", { exact: true })
    .fill("Identify the latest limit.");
  await page.getByLabel("Passes per agent", { exact: true }).fill("8");
  await page.getByRole("checkbox", { name: "Allow live web search", exact: true }).check();
  await page.getByRole("combobox", { name: "Team structure", exact: true }).selectOption("swarm");
  await page
    .getByRole("combobox", { name: "Research lead model", exact: true })
    .selectOption("analysis-model");

  await page.reload();
  await expect(context).toHaveValue("Extend the horizon and check the last reading.");
  await expect(comparison).not.toHaveAttribute("open", "");
  expect(setupReads).toBe(initialReads);
  await summary.click();
  const added = comparison.getByRole("list", { name: "Added to draft", exact: true });
  const removed = comparison.getByRole("list", { name: "Removed from draft", exact: true });
  await expect(added.getByRole("listitem")).toHaveText(["New source"]);
  await expect(removed.getByRole("listitem")).toHaveText(["Second observation"]);
  await expect(
    comparison.getByRole("list", { name: "Previous order", exact: true }).getByRole("listitem"),
  ).toHaveText(["First observation", "Second observation", "Third observation"]);
  await expect(
    comparison.getByRole("list", { name: "Draft order", exact: true }).getByRole("listitem"),
  ).toHaveText(["Third observation", "First observation", "New source"]);

  const settings = comparison.getByRole("table", { name: "Research settings", exact: true });
  await expect(settings.getByRole("row", { name: /Research lead test-model/ })).toContainText(
    "analysis-model",
  );
  await expect(settings.getByRole("row", { name: /Team structure/ })).toContainText(
    "Research swarm",
  );
  await expect(settings.getByRole("row", { name: /Team web search/ }).getByRole("cell")).toHaveText(
    ["Off", "On"],
  );
  await expect(
    settings.getByRole("row", { name: /Passes per agent/ }).getByRole("cell"),
  ).toHaveText(["6", "8"]);
  const wording = comparison.getByRole("region", { name: "Context for the lead", exact: true });
  await expect(wording).toContainText(setup.brief);
  await expect(wording).toContainText("Extend the horizon and check the last reading.");
  await comparison.getByText("Writing sample changed", { exact: true }).click();
  const sample = comparison.getByRole("region", { name: "Writing sample", exact: true });
  await expect(sample).toContainText(setup.style_excerpt);
  await expect(sample).toContainText("Identify the latest limit.");
  expect(setupReads).toBe(initialReads + 1);
  expect(writes).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
