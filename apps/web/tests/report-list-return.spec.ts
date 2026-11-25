import type { ReportSummary } from "../src/lib/reports";
import { expect, test } from "./fixtures";
import { seed } from "./report-fixture";

test("keep primary report actions together on a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/?view=reports");
  const refresh = page.getByRole("button", { name: "Refresh reports", exact: true });
  await expect(refresh).toBeEnabled();
  const actions = [
    page.getByRole("button", { name: "New report", exact: true }),
    page.getByRole("button", { name: "Style guides", exact: true }),
    refresh,
  ];
  const bounds = await Promise.all(actions.map((action) => action.boundingBox()));
  const rows = new Set(bounds.map((box) => Math.round(box!.y)));
  expect(rows.size, JSON.stringify(bounds)).toBe(1);
  expect(bounds.every((box) => box!.x >= 0 && box!.x + box!.width <= 320)).toBe(true);
});

for (const width of [390, 1440]) {
  test(`open an older report and return to its result at ${width}px`, async ({ page, request }) => {
    const tag = crypto.randomUUID().slice(0, 8);
    const { record } = await seed(request, tag);
    const summaries: ReportSummary[] = [
      ...Array.from({ length: 60 }, (_, index) => ({
        id: crypto.randomUUID(),
        series_id: crypto.randomUUID(),
        title: `Earlier synthetic report ${String(index + 1).padStart(2, "0")} ${tag}`,
        version: 1,
        author: "research_seed" as const,
        created_at: record.created_at,
        change_note: "Synthetic list entry",
      })),
      record,
    ];
    await page.route(
      (url) => url.pathname === "/api/reports" && !url.search,
      (route) => route.fulfill({ json: summaries }),
    );
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/?view=reports");
    const search = page.getByRole("searchbox", { name: "Find a recent report" });
    await search.fill(tag);
    await page.getByRole("combobox", { name: "Sort reports" }).selectOption("title");
    const row = page.locator(".report-browser-row").filter({ hasText: record.title });
    await expect(page.locator(".report-browser-row")).toHaveCount(61);
    await row.scrollIntoViewIfNeeded();
    const origin = (await row.boundingBox())!.y;
    await row.press("Enter");

    const heading = page.getByRole("heading", { name: record.title, exact: true });
    await expect(heading).toBeInViewport({ ratio: 1 });
    await expect(heading).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`report=${record.id}`));

    await page.getByRole("button", { name: "All reports", exact: true }).press("Enter");
    await expect(row).toBeFocused();
    await expect(row).toBeInViewport({ ratio: 1 });
    expect(Math.abs((await row.boundingBox())!.y - origin)).toBeLessThan(8);
    await expect(search).toHaveValue(tag);
    await expect(page.getByRole("combobox", { name: "Sort reports" })).toHaveValue("title");
  });
}
