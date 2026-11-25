import { expect, test, type Page } from "./fixtures";
import type { components } from "@researchchain/contracts";

const sourceUrl = "https://example.test/recorded";

async function wideFigure(page: Page) {
  return Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 1400;
      canvas.height = 680;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#27625a";
      context.fillRect(30, 30, 1300, 600);
      return canvas.toDataURL().split(",")[1]!;
    }),
    "base64",
  );
}

async function openSavedReport(
  page: Page,
  markdown: string,
  onRead?: () => void,
  figures: components["schemas"]["WorkspaceFile"][] = [],
) {
  const runId = crypto.randomUUID();
  const artifactId = crypto.randomUUID();
  const now = new Date().toISOString();
  await page.route(`**/api/artifacts/${artifactId}/content`, (route) => {
    onRead?.();
    return route.fulfill({ contentType: "text/markdown", body: markdown });
  });
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
                ...figures,
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

for (const width of [390, 1440]) {
  test(`keeps the selected report section in place as an earlier figure loads at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const png = await wideFigure(page);
    const figure = {
      name: "spread.png",
      artifact_id: crypto.randomUUID(),
      media_type: "image/png",
      byte_size: png.length,
    };
    const release = Promise.withResolvers<void>();
    let imageReads = 0;
    await page.route(`**/api/artifacts/${figure.artifact_id}/content*`, async (route) => {
      imageReads += 1;
      await release.promise;
      await route.fulfill({ contentType: "image/png", body: png });
    });

    try {
      const paragraph =
        "Compare the synthetic weekly observations against the saved release. ".repeat(32);
      const report = await openSavedReport(
        page,
        [
          "# Synthetic credit report",
          "## Overview",
          "![Weekly credit spreads](spread.png)",
          paragraph,
          "## Cross-check",
          paragraph,
          "## Findings",
          paragraph,
          "## Limitations",
          paragraph,
        ].join("\n\n"),
        undefined,
        [figure],
      );
      const reader = report.getByRole("region", { name: "Report text" });
      const image = reader.getByRole("img", { name: "Weekly credit spreads" });
      await image.evaluate((node) => node.scrollIntoView({ block: "nearest" }));
      await expect.poll(() => imageReads).toBe(1);
      const outline = reader.getByRole("navigation", { name: "Report contents" });
      await outline.locator("summary").press("Enter");
      await outline.getByRole("link", { name: "Cross-check", exact: true }).press("Enter");
      const target = reader.getByRole("heading", { name: "Cross-check", exact: true });
      await expect(target).toBeFocused();
      await expect(page).toHaveURL(/#study-report-section-cross-check$/);
      const bookmark = page.url();
      const offset = () =>
        target.evaluate((heading) => {
          const panel = heading.closest("#study-report-text")!;
          return heading.getBoundingClientRect().top - panel.getBoundingClientRect().top;
        });
      const scroll = () => reader.evaluate((panel) => panel.scrollTop);
      const before = await offset();
      const beforeScroll = await scroll();
      expect(before).toBeLessThan(32);
      expect(await image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(0);

      release.resolve();
      await expect
        .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
        .toBe(1400);
      await expect.poll(scroll).toBeGreaterThan(beforeScroll + 100);
      expect(Math.abs((await offset()) - before)).toBeLessThanOrEqual(2);
      await expect(target).toBeFocused();

      const focus = report.getByRole("button", { name: "Focus reading", exact: true });
      await focus.click();
      await expect(report.getByRole("button", { name: "Exit reading", exact: true })).toBeVisible();
      expect(Math.abs((await offset()) - before)).toBeLessThan(20);
      await target.press("Escape");
      await expect(focus).toBeFocused();
      expect(Math.abs((await offset()) - before)).toBeLessThanOrEqual(2);
      await expect(page).toHaveURL(bookmark);
      expect(imageReads).toBe(1);
    } finally {
      release.resolve();
    }
  });
}

test("inspects exact saved figures on a phone and returns to the same figure in Focus reading", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const png = await wideFigure(page);
  const figures = ["spread.png", "rates.png", "unused.png", "vector.svg"].map((name, index) => ({
    name,
    artifact_id: `sha256:${(index + 1).toString().repeat(64)}`,
    media_type: name.endsWith(".png") ? "image/png" : "image/svg+xml",
    byte_size: png.length,
  }));
  const [first, linked] = figures;
  const figureReads: string[] = [];
  for (const { artifact_id } of figures) {
    const encoded = encodeURIComponent(artifact_id);
    await page.route(`**/api/artifacts/${encoded}/content*`, (route) => {
      const url = new URL(route.request().url());
      figureReads.push(url.pathname + url.search);
      return route.fulfill({
        contentType: "image/png",
        headers: { "cache-control": "no-store" },
        body: png,
      });
    });
  }
  let remoteReads = 0;
  await page.route("https://example.test/**", (route) => {
    remoteReads += 1;
    return route.abort();
  });
  const figurePath = (id: string) =>
    `/api/artifacts/${encodeURIComponent(id)}/content?preview=true`;
  const firstPath = figurePath(first!.artifact_id);
  const linkedPath = figurePath(linked!.artifact_id);
  const report = await openSavedReport(
    page,
    [
      "# Synthetic credit charts",
      "![Credit spreads](./spread.png)",
      `[![Policy rates](rates.png)](${sourceUrl})`,
      "[Unrecorded source](https://example.test/no-record)",
      "![Unsaved chart](missing.png)",
      "![Remote chart](https://example.test/external.png)",
      "![Unsupported chart](vector.svg)",
      "Methodology. ".repeat(110),
    ].join("\n\n"),
    undefined,
    figures,
  );
  await report.getByRole("button", { name: "Focus reading", exact: true }).click();
  const reader = report.getByRole("region", { name: "Report text" });
  const figuresInReport = reader.getByRole("button", { name: /^Inspect figure:/ });
  const linkedButton = reader.getByRole("button", { name: "Inspect figure: Policy rates" });
  const sourceLink = reader.getByRole("link", { name: "Policy rates" });
  await expect(figuresInReport).toHaveCount(2);
  await expect(
    reader.getByRole("button", { name: "Inspect figure: Credit spreads" }),
  ).toBeVisible();
  await expect(sourceLink).toHaveAttribute("href", sourceUrl);
  await expect(sourceLink.getByRole("img")).toHaveAccessibleName("Policy rates");
  await expect(reader.locator("a button, a a")).toHaveCount(0);
  await expect(reader.getByRole("link", { name: /Unrecorded source/ })).toHaveCount(0);
  await expect(reader.getByRole("img")).toHaveCount(2);
  for (const label of ["Unsaved chart", "Remote chart", "Unsupported chart"]) {
    await expect(reader.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => [...figureReads].sort()).toEqual([firstPath, linkedPath]);

  await linkedButton.scrollIntoViewIfNeeded();
  const before = await reader.evaluate((element) => element.scrollTop);
  const savedUrl = page.url();
  await linkedButton.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Policy rates" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription("rates.png");
  await expect(dialog.getByRole("link")).toHaveCount(0);
  const image = dialog.getByRole("img", { name: "Policy rates" });
  await expect(image).toHaveAttribute("src", new URL(linkedPath, savedUrl).href);
  const original = dialog.getByRole("button", { name: "Original size", exact: true });
  const pan = dialog.getByRole("region", { name: "Chart image" });
  await expect(original).toBeEnabled();
  await expect(original).toHaveAttribute("aria-pressed", "false");
  expect(await pan.evaluate((el) => el.scrollWidth === el.clientWidth)).toBe(true);
  const afterOpen = figureReads.slice();
  // Chromium can reuse the already decoded inline image.
  expect(afterOpen.length).toBeLessThanOrEqual(3);
  if (afterOpen.length === 3) expect(afterOpen[2]).toBe(linkedPath);
  await original.press("Enter");
  await expect(original).toHaveAttribute("aria-pressed", "true");
  expect((await image.boundingBox())!.width).toBe(1400);
  await pan.press("ArrowRight");
  await expect.poll(() => pan.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(linkedButton).toBeFocused();
  await expect(report.getByRole("button", { name: "Exit reading", exact: true })).toBeVisible();
  expect(Math.abs((await reader.evaluate((element) => element.scrollTop)) - before)).toBeLessThan(
    2,
  );
  await expect(page).toHaveURL(savedUrl);
  expect(figureReads).toEqual(afterOpen);
  expect(remoteReads).toBe(0);
});

test("focuses the existing report, preserves its place, and exits with Escape", async ({
  page,
}) => {
  let reads = 0;
  await page.setViewportSize({ width: 1280, height: 900 });
  const paragraph = "Compare the chronological observations with the saved baseline. ".repeat(70);
  const report = await openSavedReport(
    page,
    [
      "# Synthetic long report",
      "## Overview",
      paragraph,
      "## Cross-check",
      paragraph,
      "## Findings",
      paragraph,
      "## Limitations",
      paragraph,
    ].join("\n\n"),
    () => reads++,
  );

  const reader = report.getByRole("region", { name: "Report text" });
  const workspaces = page.getByRole("navigation", { name: "Agent workspaces" });
  const focus = report.getByRole("button", { name: "Focus reading", exact: true });
  const exit = report.getByRole("button", { name: "Exit reading", exact: true });
  const edit = report.getByRole("link", { name: "Edit in Reports" });
  const download = report.getByRole("link", { name: "Download report and files" });
  const passes = report.getByText("Model passes (1)", { exact: true });
  await passes.click();
  const contents = report.getByRole("navigation", { name: "Report contents" });
  await contents.locator("summary").click();
  await contents.getByRole("link", { name: "Cross-check", exact: true }).click();
  const target = reader.getByRole("heading", { name: "Cross-check", exact: true });
  await expect(target).toBeInViewport();
  await target.evaluate((heading) => heading.setAttribute("data-original-heading", ""));
  const bookmark = page.url();
  const initialReads = reads;
  const width = (await reader.boundingBox())!.width;
  const editorHref = (await edit.getAttribute("href"))!;
  const downloadHref = (await download.getAttribute("href"))!;
  const readingOffset = () =>
    target.evaluate((heading) => {
      const panel = heading.closest("#study-report-text")!;
      return heading.getBoundingClientRect().top - panel.getBoundingClientRect().top;
    });
  const offset = await readingOffset();

  await focus.click();
  await expect(exit).toHaveAttribute("aria-keyshortcuts", "Escape");
  await expect(exit.getByText("Esc", { exact: true })).toBeVisible();
  await expect(exit).toHaveAttribute("aria-controls", "study-report-text");
  await expect(workspaces).toBeHidden();
  await expect(passes).toBeHidden();
  expect((await reader.boundingBox())!.width).toBeGreaterThan(width + 100);
  await expect(target).toBeInViewport();
  expect(Math.abs((await readingOffset()) - offset)).toBeLessThan(20);
  await expect(target).toHaveAttribute("data-original-heading", "");
  await expect(edit).toHaveAttribute("href", editorHref);
  await expect(download).toHaveAttribute("href", downloadHref);
  await expect(page.getByRole("button", { name: "Copy study link" })).toBeVisible();
  await expect(page).toHaveURL(bookmark);

  await target.press("Escape");
  await expect(focus).toBeFocused();
  await expect(workspaces.getByRole("button", { name: /^Report editor/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(report.getByLabel("Inspect model pass")).toBeVisible();
  await expect(target).toHaveAttribute("data-original-heading", "");
  await expect(page).toHaveURL(bookmark);
  expect(reads).toBe(initialReads);

  await page.setViewportSize({ width: 390, height: 844 });
  await focus.click();
  await expect(exit).toBeVisible();
  await expect(workspaces).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await exit.click();
  await expect(workspaces).toBeVisible();
  expect(reads).toBe(initialReads);
});
