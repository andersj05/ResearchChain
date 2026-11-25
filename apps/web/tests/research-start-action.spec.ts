import { pinDeskNote } from "./desk-material";
import { expect, test } from "./fixtures";

test("start with the edited settings while the first-reading action stays visible", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const start = page.getByRole("button", { name: "Ask the lead for a first reading" });
  await expect(start).toBeInViewport();
  await expect(start).toBeDisabled();
  await expect(page.getByRole("link", { name: "Pin a source to begin" })).toBeInViewport();

  const sourceId = await pinDeskNote(page);
  const settings = page.getByRole("navigation", { name: "Study sections" });
  await settings.getByRole("link", { name: "Research settings" }).click();
  await page.getByRole("checkbox", { name: "Allow live web search" }).check();
  await page.getByRole("spinbutton", { name: "Passes per agent" }).fill("5");
  const roleSettings = page.getByRole("heading", {
    name: /^(Research lead|Researchers|Report editor)$/,
  });
  await expect(roleSettings).toHaveCount(3);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole("spinbutton", { name: "Passes per agent" }).scrollIntoViewIfNeeded();
    await expect(start).toBeInViewport({ ratio: 1 });
    await expect(start).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const tops = await roleSettings.evaluateAll((headings) =>
      headings.map((heading) => Math.round(heading.getBoundingClientRect().top)),
    );
    expect(new Set(tops).size, `Role heading rows at ${width}px`).toBe(width === 1280 ? 1 : 3);
    await page.screenshot({ path: info.outputPath(`first-reading-action-${width}.png`) });
  }
  await page.route("**/api/research-sessions", (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  const started = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/api/research-sessions"),
  );
  await start.click();
  expect((await started).postDataJSON()).toMatchObject({
    evidence_ids: [sourceId],
    max_passes: 5,
    web_search: true,
    start_from_sources: true,
  });
});
