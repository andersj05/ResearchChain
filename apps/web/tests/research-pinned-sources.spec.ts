import { expect, test } from "./fixtures";

test("recover ordered pinned-source attribution only when the reader asks for it", async ({
  page,
}) => {
  const runId = crypto.randomUUID();
  const [chart, reference, legacy, changed] = Array.from({ length: 4 }, () => crypto.randomUUID());
  const chartHash = `sha256:${"a".repeat(64)}`;
  const changedHash = `sha256:${"b".repeat(64)}`;
  const pinnedChartDate = "2026-11-20";
  const chartTitle = "Owner’s named chart";
  const now = "2026-11-24T18:00:00Z";
  const reads: string[] = [];
  const originals: string[] = [];
  let referenceAvailable = false;
  const records = new Map([
    [
      chart,
      {
        id: chart,
        title: chartTitle,
        kind: "file",
        author: "Research desk",
        content_hash: chartHash,
        as_of_date: "2026-11-23",
      },
    ],
    [reference, { id: reference, title: "Owner’s named reference", content_hash: null }],
    [
      legacy,
      {
        id: legacy,
        title: "Legacy conversation",
        kind: "discussion",
        author: "Rates desk",
        as_of_date: "2026-10-09",
      },
    ],
    [
      changed,
      {
        id: changed,
        title: "Different library title",
        content_hash: `sha256:${"c".repeat(64)}`,
      },
    ],
  ]);
  await page.route("**/api/evidence/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    reads.push(id);
    const record = records.get(id);
    if (!record || (id === reference && !referenceAvailable)) return route.fulfill({ status: 404 });
    return route.fulfill({ json: record });
  });
  await page.route(`**/api/artifacts/${encodeURIComponent(chartHash)}/content`, (route) => {
    originals.push(chartHash);
    return route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAKsAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  });
  await page.route(`**/api/runs/${runId}`, (route) =>
    route.fulfill({
      json: {
        id: runId,
        brief: "Review the saved source packet",
        created_at: now,
        status: "completed",
        execution_pending: false,
        events: [],
        artifacts: [
          { id: chartHash, name: "screenshot-original.png" },
          { id: changedHash, name: "earlier-original.csv" },
        ],
        evidence_ids: [chart, reference, legacy, changed],
        workflow: { nodes: [] },
        research_manifest: {
          settings: { model: "synthetic", limits: { max_model_calls: 30 } },
          tool_config: { session: "brief-led-1", discovery_version: "source-discovery-1" },
          evidence: [
            {
              evidence_id: chart,
              original: chartHash,
              representation: "chart_screenshot",
              availability: "available",
              publisher: "Series publisher",
              as_of_date: pinnedChartDate,
            },
            {
              evidence_id: reference,
              original: null,
              representation: "original",
              availability: "reference_only",
              publisher: "Recorded publisher",
              as_of_date: "2026-11-19",
              source_url: "https://example.test/archive",
            },
            {
              evidence_id: changed,
              original: changedHash,
              representation: "numeric_data",
              availability: "available",
              publisher: "",
              source_url: "https://stored-credential@example.test/private",
            },
          ],
        },
        model_attempts: [
          {
            id: crypto.randomUUID(),
            path: "root/discovery",
            model: "synthetic",
            status: "completed",
            created_at: now,
            finished_at: now,
            result: {
              discovery: {
                observation: "The final release is above the start of the series.",
                question: "What explains the difference?",
                proposals: [],
                citations: [
                  {
                    evidence_id: chart,
                    relation: "context",
                    basis: "image_interpretation",
                    locator: "First panel",
                    rationale: "The chart records the first and last values.",
                  },
                ],
              },
            },
          },
        ],
      },
    }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?session=${runId}&workspace=lead`);
  await expect(page.getByRole("heading", { name: "Review the saved source packet" })).toBeVisible();
  const history = page.getByText("Read the original lead proposal", { exact: true });
  const historySources = page.getByRole("complementary", { name: "Evidence behind the reading" });
  const settings = page.getByText("Sources and settings", { exact: true });
  const section = page.getByRole("region", { name: "Pinned study sources" });
  await expect(history).toBeVisible();
  await expect(historySources).toHaveCount(0);
  await expect(section).toHaveCount(0);
  expect(reads).toEqual([]);
  expect(originals).toEqual([]);

  await history.press("Enter");
  await expect(historySources.getByRole("heading", { name: chartTitle })).toBeVisible();
  expect(reads).toEqual([chart]);

  await settings.press("Enter");
  const rows = section.getByRole("listitem");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText(`Chart screenshot · As of ${pinnedChartDate} · Captured`);
  await expect(rows.nth(0)).toContainText("Author Research desk · Publisher Series publisher");
  await expect(rows.nth(0)).not.toContainText("2026-11-23");
  await expect(rows.nth(0).getByRole("link", { name: chartTitle })).toHaveAttribute(
    "href",
    `/?view=evidence&evidence=${chart}`,
  );
  await expect(rows.nth(1)).toContainText("Recorded publisher");
  await expect(rows.nth(1)).toContainText("Saved snapshot · Source record unavailable");
  await expect(rows.nth(1)).toContainText("As of 2026-11-19 · Link only");
  await expect(
    rows.nth(1).getByRole("link", { name: "Recorded URL at example.test" }),
  ).toHaveAttribute("href", "https://example.test/archive");
  await expect(rows.nth(2)).toContainText("Legacy conversation");
  await expect(rows.nth(2)).toContainText(
    "From source record · Original source · As of 2026-10-09",
  );
  await expect(rows.nth(2)).toContainText("Speaker Rates desk");
  await expect(rows.nth(3)).toContainText("earlier-original.csv");
  await expect(rows.nth(3)).toContainText("Source record differs from the pinned original");
  await expect(rows.nth(3)).not.toContainText("Different library title");
  await expect(rows.nth(3).getByRole("link")).toHaveCount(0);
  expect([...reads].sort()).toEqual([chart, reference, legacy, changed].sort());

  referenceAvailable = true;
  await section.getByRole("button", { name: "Retry unavailable sources" }).click();
  await expect(rows.nth(1).getByRole("link", { name: "Owner’s named reference" })).toBeVisible();
  expect(reads).toHaveLength(5);
  expect(reads.at(-1)).toBe(reference);
  await settings.press("Enter");
  await expect(section).toBeHidden();
  await settings.press("Enter");
  await expect(rows.nth(0).getByRole("link", { name: chartTitle })).toBeVisible();
  expect(reads).toHaveLength(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
