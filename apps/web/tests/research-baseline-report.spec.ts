import { expect, test, type Page } from "./fixtures";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=",
  "base64",
);

function savedReport(title: string, citations: string[]) {
  const body = [
    `# ${title}`,
    "## Observation",
    "These observations come from the final editor. ".repeat(38),
    "## Evidence",
    "![Credit chart](credit.png)",
    ...citations,
    "## Risks",
    "Review the original source.",
    "## Limits",
    "Synthetic study only.",
  ].join("\n\n");
  const file = {
    name: "report.md",
    artifact_id: crypto.randomUUID(),
    media_type: "text/markdown",
    byte_size: Buffer.byteLength(body),
  };
  const chart = {
    name: "credit.png",
    artifact_id: crypto.randomUUID(),
    media_type: "image/png",
    byte_size: png.length,
  };
  return { body, file, chart };
}

async function mockComparison(
  page: Page,
  scenario: "complete" | "missing" | "paused" | "earlier-output-only" = "complete",
) {
  const currentId = crypto.randomUUID();
  const baselineId = crypto.randomUUID();
  const now = new Date().toISOString();
  const currentUrl = "https://example.test/current-evidence";
  const baselineUrl = "https://example.test/baseline-evidence";
  const currentCitation = `[Current evidence](${currentUrl})`;
  const baselineCitation = `[Baseline evidence](${baselineUrl})`;
  const current = savedReport("Final revised report", [currentCitation, baselineCitation]);
  const baseline = savedReport("Final baseline report", [baselineCitation, currentCitation]);
  const early = savedReport("Earlier baseline draft", []);
  const reads: string[] = [];
  for (const report of [current, baseline, early]) {
    for (const file of [report.file, report.chart]) {
      await page.route(`**/api/artifacts/${file.artifact_id}/content*`, (route) => {
        reads.push(file.artifact_id);
        return route.fulfill({
          contentType: file.media_type,
          body: file === report.file ? report.body : png,
        });
      });
    }
  }

  function attempt(report: typeof current, path: string, citation?: string) {
    return {
      id: crypto.randomUUID(),
      path,
      status: "completed",
      model: "synthetic",
      created_at: now,
      finished_at: now,
      result: {
        limitations: [],
        workspace_files: [report.file, report.chart],
        report_artifact: citation ? report.file : undefined,
        workspace_activity: citation
          ? undefined
          : { status: "completed", files: [report.file, report.chart] },
        web_research: citation
          ? { sources: [{ title: "Recorded source", url: citation, cited: true }] }
          : undefined,
      },
    };
  }

  function snapshot(id: string, title: string) {
    return {
      id,
      brief: title,
      study_title: title,
      created_at: now,
      execution_pending: false,
      events: [],
      artifacts: [],
      evidence_ids: [],
      workflow: { nodes: [] },
      research_manifest: {
        settings: { model: "synthetic", limits: { max_model_calls: 20 } },
        evidence: [],
        tool_config: { session: "brief-led-1" },
      },
    };
  }

  await page.route(`**/api/runs/${currentId}`, (route) =>
    route.fulfill({
      json: {
        ...snapshot(currentId, "Revised study"),
        baseline_run_id: baselineId,
        status: "completed",
        model_attempts: [attempt(current, "root/report", currentUrl)],
      },
    }),
  );
  let baselineReads = 0;
  await page.route(`**/api/runs/${baselineId}`, (route) => {
    baselineReads += 1;
    if (scenario === "missing") return route.fulfill({ status: 404 });
    const final = attempt(baseline, "root/report/analyst-pass-2", baselineUrl);
    const result =
      scenario === "earlier-output-only"
        ? { limitations: [], workspace_files: [baseline.chart] }
        : final.result;
    return route.fulfill({
      json: {
        ...snapshot(baselineId, "Original study"),
        status: scenario === "paused" && baselineReads === 1 ? "paused" : "completed",
        model_attempts: [attempt(early, "root/report"), { ...final, result }],
      },
    });
  });
  await page.goto(`/?session=${currentId}&workspace=editor`);
  const editor = page.getByRole("region", { name: "Report editor workspace" });
  const currentText = editor.getByRole("region", { name: "Report text", exact: true });
  const disclosure = editor.getByText("Baseline report", { exact: true });
  await expect(currentText.getByRole("heading", { name: "Final revised report" })).toBeVisible();
  return {
    current,
    baseline,
    early,
    reads,
    baselineReads: () => baselineReads,
    editor,
    currentText,
    disclosure,
    baselineId,
    currentId,
    currentUrl,
    baselineUrl,
  };
}

for (const width of [390, 1440]) {
  test(`reads the recorded final baseline next to the current report at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const pair = await mockComparison(page);
    const { editor, currentText, disclosure } = pair;
    const contents = currentText.getByRole("navigation", { name: "Report contents" });
    await contents.getByText("Contents", { exact: true }).click();
    await contents.getByRole("link", { name: "Evidence", exact: true }).click();
    const askedFor = page.locator("#study-report-section-evidence");
    await expect(askedFor).toBeFocused();
    await askedFor.evaluate((heading) => heading.setAttribute("data-initial-heading", ""));
    const bookmark = page.url();
    const offset = await currentText.evaluate((panel) => panel.scrollTop);
    await expect(page.getByRole("link", { name: "Compare with baseline" })).toHaveAttribute(
      "href",
      `/?view=runs&run=${pair.currentId}&compare=${pair.baselineId}`,
    );
    expect(pair.baselineReads()).toBe(0);
    expect(
      pair.reads.every((id) =>
        [pair.current.file.artifact_id, pair.current.chart.artifact_id].includes(id),
      ),
    ).toBe(true);

    await disclosure.press("Enter");
    const baselineText = editor.getByRole("region", { name: "Baseline report text", exact: true });
    await expect(
      baselineText.getByRole("heading", { name: "Final baseline report" }),
    ).toBeVisible();
    expect(
      Math.abs((await currentText.evaluate((panel) => panel.scrollTop)) - offset),
    ).toBeLessThan(2);
    await expect(editor.getByRole("heading", { name: "Original study" })).toBeVisible();
    await expect(currentText.getByRole("link", { name: "Current evidence" })).toHaveAttribute(
      "href",
      pair.currentUrl,
    );
    await expect(currentText.getByRole("link", { name: "Baseline evidence" })).toHaveCount(0);
    await expect(baselineText.getByRole("link", { name: "Baseline evidence" })).toHaveAttribute(
      "href",
      pair.baselineUrl,
    );
    await expect(baselineText.getByRole("link", { name: "Current evidence" })).toHaveCount(0);
    const currentChart = currentText.getByRole("img", { name: "Credit chart" });
    const baselineChart = baselineText.getByRole("img", { name: "Credit chart" });
    for (const [image, id] of [
      [currentChart, pair.current.chart.artifact_id],
      [baselineChart, pair.baseline.chart.artifact_id],
    ] as const) {
      await expect(image).toHaveAttribute("src", `/api/artifacts/${id}/content?preview=true`);
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => pair.reads.includes(id)).toBe(true);
    }
    expect(pair.baselineReads()).toBe(1);
    expect(pair.reads).toContain(pair.current.file.artifact_id);
    expect(pair.reads).toContain(pair.baseline.file.artifact_id);
    expect(pair.reads).not.toContain(pair.early.file.artifact_id);
    expect(pair.reads).not.toContain(pair.early.chart.artifact_id);
    await expect(askedFor).toHaveCount(1);
    await expect(askedFor).toHaveAttribute("data-initial-heading", "");
    await expect(page).toHaveURL(bookmark);

    const reads = pair.reads.slice();
    const savedPanelOffset = await currentText.evaluate((panel) => panel.scrollTop);
    await disclosure.press("Enter");
    await expect(baselineText).toBeHidden();
    await disclosure.press("Enter");
    await expect(baselineText).toBeVisible();
    await expect(askedFor).toHaveAttribute("data-initial-heading", "");
    expect(
      Math.abs((await currentText.evaluate((panel) => panel.scrollTop)) - savedPanelOffset),
    ).toBeLessThan(2);
    expect(pair.baselineReads()).toBe(1);
    expect(pair.reads).toEqual(reads);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

for (const scenario of ["missing", "paused", "earlier-output-only"] as const) {
  test(`keeps the current report available when the baseline is ${scenario}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const pair = await mockComparison(page, scenario);
    expect(pair.baselineReads()).toBe(0);
    await pair.disclosure.press("Enter");
    await expect(
      pair.editor.getByText(
        scenario === "missing"
          ? "The baseline study is unavailable."
          : "The baseline study has no completed report.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(pair.editor.getByRole("region", { name: "Baseline report text" })).toHaveCount(0);
    await expect(
      pair.currentText.getByRole("heading", { name: "Final revised report" }),
    ).toBeVisible();
    expect(pair.baselineReads()).toBe(1);
    expect(
      pair.reads.every((id) =>
        [pair.current.file.artifact_id, pair.current.chart.artifact_id].includes(id),
      ),
    ).toBe(true);
    if (scenario === "paused") {
      await pair.disclosure.press("Enter");
      await pair.disclosure.press("Enter");
      await expect(
        pair.editor
          .getByRole("region", { name: "Baseline report text" })
          .getByRole("heading", { name: "Final baseline report" }),
      ).toBeVisible();
      expect(pair.baselineReads()).toBe(2);
      expect(pair.reads).toContain(pair.baseline.file.artifact_id);
      expect(pair.reads).not.toContain(pair.early.file.artifact_id);
    }
  });
}
