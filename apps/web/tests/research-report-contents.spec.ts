import { expect, test, type Page } from "./fixtures";

const sourceUrl = "https://example.test/recorded";

async function openSavedReport(page: Page, markdown: string) {
  const runId = crypto.randomUUID();
  const artifactId = crypto.randomUUID();
  const now = new Date().toISOString();
  await page.route(`**/api/artifacts/${artifactId}/content`, (route) =>
    route.fulfill({ contentType: "text/markdown", body: markdown }),
  );
  await page.route(`**/api/runs/${runId}`, (route) =>
    route.fulfill({
      json: {
        id: runId,
        brief: "Compare credit spread vintages.",
        created_at: now,
        status: "completed",
        execution_pending: false,
        events: [],
        artifacts: [],
        evidence_ids: [],
        workflow: { nodes: [] },
        research_manifest: {
          settings: { model: "synthetic", limits: { max_model_calls: 30 } },
          evidence: [],
          tool_config: { session: "brief-led-1" },
        },
        model_attempts: [
          {
            id: crypto.randomUUID(),
            path: "root/report",
            status: "completed",
            model: "synthetic",
            created_at: now,
            finished_at: now,
            result: {
              limitations: [],
              workspace_files: [
                {
                  name: "report.md",
                  artifact_id: artifactId,
                  media_type: "text/markdown",
                  byte_size: Buffer.byteLength(markdown),
                },
              ],
              web_research: { sources: [{ title: "Primary source", url: sourceUrl, cited: true }] },
            },
          },
        ],
      },
    }),
  );
  await page.goto(`/?session=${runId}&workspace=editor`);
  return page.getByRole("region", { name: "Report editor workspace" });
}

test("jumps to exact parsed report headings and keeps Unicode bookmarks stable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const report = await openSavedReport(
    page,
    [
      "# Synthetic credit report",
      "",
      "## **Résumé** · 研究",
      "",
      `Compare the early data with the [Primary source](${sourceUrl}).`,
      "",
      "A historical paragraph with room between the sections. ".repeat(36),
      "",
      "## Re\u0301sume\u0301 · 研究",
      "",
      "The second report section uses the same visible heading.",
      "",
      "## Résumé · 研究-2",
      "",
      "This title collides with a generated suffix.",
      "",
      "Risk check",
      "----------",
      "",
      "### Follow-up on `duration`",
      "",
      "Use the corresponding rows to calculate the cross-check.",
      "",
      "```md",
      "## Fenced example",
      "```",
      "",
      "<h2>Raw HTML heading</h2>",
      "",
      "> ## Quoted heading",
      "",
      "[Unrecorded source](https://example.test/unrecorded)",
      "",
      "[Untrusted fragment](#study-report-section-risk-check)",
    ].join("\n"),
  );

  await expect(report.getByRole("heading", { name: "Synthetic credit report" })).toBeVisible();
  const contents = report.getByRole("navigation", { name: "Report contents" });
  await contents.locator("summary").press("Enter");
  const links = contents.getByRole("link");
  await expect(links).toHaveCount(5);
  await expect(contents.getByRole("link", { name: "Risk check", exact: true })).toBeVisible();
  await expect(contents.getByRole("link", { name: "Follow-up on duration" })).toBeVisible();
  await expect(contents.getByRole("link", { name: /fenced|quoted|raw HTML/i })).toHaveCount(0);
  await expect(report.getByRole("link", { name: "Unrecorded source" })).toHaveCount(0);
  await expect(report.getByRole("link", { name: "Untrusted fragment" })).toHaveCount(0);
  await expect(report.getByRole("link", { name: "Primary source" })).toHaveAttribute(
    "href",
    sourceUrl,
  );
  const ids = await links.evaluateAll((anchors) =>
    anchors.map((link) => decodeURIComponent(link.getAttribute("href")!.slice(1))),
  );
  expect(new Set(ids).size).toBe(5);
  expect(ids.slice(0, 3)).toEqual([
    "study-report-section-résumé-研究",
    "study-report-section-résumé-研究-2",
    "study-report-section-résumé-研究-2-2",
  ]);

  const target = report.locator(`[id="${ids[1]}"]`);
  await links.nth(1).press("Enter");
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport();
  expect(decodeURIComponent(new URL(page.url()).hash.slice(1))).toBe(ids[1]);
  const bookmark = page.url();
  await page.reload();
  await expect(page).toHaveURL(bookmark);
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.setViewportSize({ width: 1280, height: 900 });
  await contents.locator("summary").click();
  await contents.getByRole("link", { name: "Risk check", exact: true }).click();
  await expect(report.locator('[id="study-report-section-risk-check"]')).toBeInViewport();
});

test("keeps the contents list out of a short report", async ({ page }) => {
  const report = await openSavedReport(
    page,
    "# Short finding\n\n## Observation\n\nThe available series are consistent.\n\n## Limitations\n\nOne release remains unverified.",
  );
  await expect(report.getByRole("heading", { name: "Observation" })).toBeVisible();
  await expect(report.getByRole("navigation", { name: "Report contents" })).toHaveCount(0);
});
