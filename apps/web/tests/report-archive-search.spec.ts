import { expect, test } from "./fixtures";
import { seed } from "./report-fixture";
import type { ReportRevision, ReportSummary } from "../src/lib/reports";

test("find a saved report outside the recent window and return to its result", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const marker = `archive %_ ${crypto.randomUUID().slice(0, 8)}`;
  const { record, guide, run } = await seed(request, marker);
  const changed = await request.post("/api/reports/revisions", {
    data: {
      id: crypto.randomUUID(),
      base_revision_id: record.id,
      title: `${record.title} follow-up`,
      style_guide_id: guide.id,
      sections: record.sections,
      evidence_ids: record.sources.map(({ id }) => id),
      change_note: `Follow-through on the ${marker} packet.`,
    },
  });
  expect(changed.status()).toBe(201);
  const saved: ReportRevision = await changed.json();

  for (let index = 0; index < 101; index += 1) {
    const response = await request.post("/api/reports", {
      data: {
        id: crypto.randomUUID(),
        title: `Newer report ${marker.slice(-8)} ${index + 1}`,
        run_id: run.id,
        attempt_id: run.model_attempts[0].id,
        style_guide_id: guide.id,
      },
    });
    expect(response.status()).toBe(201);
  }
  const recent: ReportSummary[] = await (await request.get("/api/reports")).json();
  expect(recent).toHaveLength(100);
  expect(recent.some(({ series_id }) => series_id === record.series_id)).toBe(false);
  expect((await request.get("/api/reports?search=%00")).status()).toBe(422);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=reports");
  const search = page.getByRole("searchbox");
  await search.fill(`  ${marker.toUpperCase()}  `);
  const result = page.getByRole("button").filter({ hasText: saved.title });
  await expect(result).toContainText("Revision 2");
  await expect(result).toContainText(saved.change_note);
  await result.press("Enter");
  await expect(page.getByRole("heading", { name: saved.title, exact: true })).toBeInViewport();
  expect(new URL(page.url()).searchParams.get("report")).toBe(saved.id);
  await page.getByRole("button", { name: "All reports", exact: true }).press("Enter");
  await expect(result).toBeFocused();
  await expect(search).toHaveValue(`  ${marker.toUpperCase()}  `);

  const slowQuery = "an unrelated search";
  const slowRequested = Promise.withResolvers<void>();
  const releaseSlowSearch = Promise.withResolvers<void>();
  const isSlow = (url: URL) =>
    url.pathname === "/api/reports" && url.searchParams.get("search") === slowQuery;
  await page.route(isSlow, async (route) => {
    slowRequested.resolve();
    await releaseSlowSearch.promise;
    await route.fulfill({ json: [] });
  });
  try {
    await search.fill(slowQuery);
    await slowRequested.promise;
    await search.fill(`Follow-through on the ${marker}`);
    await expect(result).toContainText("Revision 2");
    const slowResponse = page.waitForResponse((response) => isSlow(new URL(response.url())));
    releaseSlowSearch.resolve();
    await (await slowResponse).finished();
    await expect(result).toContainText("Revision 2");
  } finally {
    releaseSlowSearch.resolve();
  }
});
