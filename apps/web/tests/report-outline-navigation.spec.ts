import type { ReportRevision, ReportSection } from "../src/lib/reports";
import { expect, test, type APIRequestContext } from "./fixtures";
import { seed } from "./report-fixture";

const query = "archive coupon";
const lastTitle = "Archived funding ladder by maturity";

async function longReport(request: APIRequestContext, width: number) {
  const { record } = await seed(request, `outline navigation ${width}`);
  const sections: ReportSection[] = Array.from({ length: 40 }, (_, index) => ({
    id: crypto.randomUUID(),
    heading: index === 39 ? lastTitle : `Synthetic scenario ${index + 1}`,
    body: [6, 20, 39].includes(index)
      ? `Archive coupon signal for scenario ${index + 1}. Compare synthetic maturities.`
      : `Synthetic discussion of scenario ${index + 1}.`,
    kind: "interpretation",
    citations: [],
    chart_ids: [],
  }));
  const response = await request.post("/api/reports/revisions", {
    data: {
      id: crypto.randomUUID(),
      base_revision_id: record.id,
      title: record.title,
      style_guide_id: record.style_guide_id,
      evidence_ids: record.sources.map(({ id }) => id),
      sections,
      change_note: "Seed the synthetic outline.",
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return {
    report: (await response.json()) as ReportRevision,
    middle: sections[20]!,
    last: sections[39]!,
  };
}

for (const width of [320, 390, 1440]) {
  test(`select a filtered outline result at ${width}px`, async ({ page, request }) => {
    const { report, middle, last } = await longReport(request, width);
    let writes = 0;
    await page.route("**/api/reports/revisions", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      writes++;
      return route.abort();
    });
    const reportUrl = `/?view=reports&report=${report.id}`;
    await page.setViewportSize({ width, height: width === 320 ? 740 : width === 390 ? 844 : 900 });
    await page.goto(reportUrl);
    const outline = page.getByRole("navigation", { name: "Report sections", exact: true });
    const search = page.getByRole("searchbox", { name: "Find a section", exact: true });
    const target = outline.getByRole("button", { name: `40. ${lastTitle}`, exact: true });
    const other = outline.getByRole("button", { name: `21. ${middle.heading}`, exact: true });
    const back = page.getByRole("button", { name: "Back to sections", exact: true });
    const heading = page.getByRole("textbox", { name: "Section heading", exact: true });
    const text = page.getByRole("textbox", { name: "Section text", exact: true });
    await expect(back).toHaveCount(0);
    await search.fill(query);
    await expect(outline.getByRole("button")).toHaveCount(3);
    await search.focus();
    for (let tab = 0; tab < 4; tab++) await page.keyboard.press("Tab");
    await expect(target).toBeFocused();
    const before = (await target.boundingBox())!.y;
    await page.keyboard.press("Enter");
    await expect(target).toHaveAttribute("aria-current", "true");
    await expect(heading).toHaveValue(last.heading);
    await expect(text).toHaveValue(last.body);
    await expect(search).toHaveValue(query);

    if (width === 1440) {
      await expect(back).toHaveCount(0);
      await expect(target).toBeFocused();
      expect(Math.abs((await target.boundingBox())!.y - before)).toBeLessThan(2);
      await page.keyboard.press("Shift+Tab");
      await expect(other).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(other).toBeFocused();
      await expect(text).toHaveValue(middle.body);
    } else {
      await expect(heading).toBeFocused();
      await expect(heading).toBeInViewport();
      await expect(text).toBeInViewport();
      await expect(back).toBeInViewport();
      await page.keyboard.press("Shift+Tab");
      await expect(back).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(target).toBeFocused();
      await expect(target).toBeInViewport();
      await expect(heading).toHaveValue(last.heading);

      await target.click();
      await expect(heading).toBeInViewport();
      await expect(text).toBeInViewport();
      await expect(heading).not.toBeFocused();
      await expect(text).not.toBeFocused();
      await page.getByRole("button", { name: "Preview draft section" }).click();
      const preview = page.getByRole("region", { name: "Unsaved section preview" });
      await expect(preview).toContainText(last.body);
      await back.press("Enter");
      await expect(target).toBeFocused();

      await other.press("Enter");
      await expect(heading).toBeFocused();
      await expect(preview).toContainText(middle.body);
      await back.press("Enter");
      await expect(other).toBeFocused();
      await target.press("Enter");
      await expect(preview).toContainText(last.body);
      await page.getByRole("button", { name: "Return to section text" }).click();
      await expect(text).toBeFocused();
      await text.fill("An unsaved observation with a new search term.");
      await expect(target).toHaveCount(0);
      await back.press("Enter");
      await expect(search).toBeFocused();
      await expect(search).toBeInViewport();
      await expect(search).toHaveValue(query);
      await expect(outline.getByRole("button")).toHaveCount(2);
      await expect(heading).toHaveValue(last.heading);
      await expect(text).toHaveValue("An unsaved observation with a new search term.");
    }

    await expect(page).toHaveURL(reportUrl);
    expect(writes).toBe(0);
  });
}
