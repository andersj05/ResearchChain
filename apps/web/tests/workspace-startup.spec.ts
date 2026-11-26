import type { Response } from "@playwright/test";
import { expect, test, type Page } from "./fixtures";

async function sampleStartup(page: Page, path: string, ready: () => Promise<void>) {
  const scripts = new Map<string, Response>();
  page.on("response", (response) => {
    const asset = new URL(response.url()).pathname;
    if (response.ok() && asset.startsWith("/_next/static/") && asset.endsWith(".js"))
      scripts.set(asset, response);
  });
  const start = performance.now();
  await page.goto(path);
  await ready();
  const readyMs = Math.round(performance.now() - start);
  const bodies = await Promise.all([...scripts.values()].map((response) => response.body()));
  const transferBytes = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((entry) => {
        const asset = new URL(entry.name).pathname;
        return asset.startsWith("/_next/static/") && asset.endsWith(".js");
      })
      .reduce((total, entry) => total + (entry as PerformanceResourceTiming).transferSize, 0),
  );
  return {
    includesBuilder: bodies.some((body) => body.includes("Build your agent")),
    includesStudyReader: bodies.some((body) => body.includes("Recorded editorial judgment")),
    includesMethodology: bodies.some((body) => body.includes("Research desk workflow")),
    includesSetupComparison: bodies.some((body) => body.includes("Compare with previous setup")),
    scripts: scripts.size,
    decodedBytes: bodies.reduce((total, body) => total + body.length, 0),
    transferBytes,
    readyMs,
  };
}

test("load the Workbench, methodology and saved-study reader only when their views open", async ({
  browser,
  baseURL,
  ownerSession,
}, info) => {
  test.setTimeout(60_000);
  const locked = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const desk = await browser.newContext({ baseURL, storageState: ownerSession.state });
  const build = await browser.newContext({ baseURL, storageState: ownerSession.state });
  const study = await browser.newContext({ baseURL, storageState: ownerSession.state });
  const methodology = await browser.newContext({ baseURL, storageState: ownerSession.state });
  try {
    const lockedPage = await locked.newPage();
    const lockedStartup = await sampleStartup(lockedPage, "/?view=workflow", async () => {
      await expect(lockedPage.getByRole("heading", { name: "Owner sign-in" })).toBeVisible();
    });
    const deskPage = await desk.newPage();
    const deskStartup = await sampleStartup(deskPage, "/", async () => {
      await expect(deskPage.getByRole("button", { name: /Drop files or browse/ })).toBeEnabled();
    });
    const buildPage = await build.newPage();
    const buildStartup = await sampleStartup(buildPage, "/?view=workflow", async () => {
      await expect(buildPage.getByRole("button", { name: "Run workflow" })).toBeEnabled();
    });
    const studyId = crypto.randomUUID();
    const studyTitle = "Synthetic saved research study";
    const studyPage = await study.newPage();
    await studyPage.route(`**/api/runs/${studyId}`, (route) =>
      route.fulfill({
        json: {
          id: studyId,
          revision_id: crypto.randomUUID(),
          revision_number: 1,
          workflow_name: "Research session",
          brief: studyTitle,
          status: "completed",
          compiler_version: "research-0.3.0",
          created_at: new Date().toISOString(),
          workflow: { nodes: [], budgets: { max_active_seconds: 1800 } },
          events: [],
          artifacts: [],
          execution_pending: false,
          research_manifest: {
            tool_config: { session: "brief-led-1" },
            evidence: [],
            settings: { model: "test-model", limits: { max_model_calls: 25 } },
          },
        },
      }),
    );
    const studyStartup = await sampleStartup(studyPage, `/?session=${studyId}`, async () => {
      await expect(studyPage.getByRole("heading", { name: studyTitle, exact: true })).toBeVisible();
    });

    const methodologyPage = await methodology.newPage();
    const methodologyStartup = await sampleStartup(
      methodologyPage,
      "/?view=methodology",
      async () => {
        await expect(
          methodologyPage.getByRole("group", { name: "Research desk workflow" }),
        ).toBeVisible();
      },
    );

    const metrics = { lockedStartup, deskStartup, buildStartup, studyStartup, methodologyStartup };
    await info.attach("workspace-startup", {
      body: JSON.stringify(metrics, null, 2),
      contentType: "application/json",
    });
    console.log(
      JSON.stringify({
        mode:
          process.env.CI || process.env.RESEARCHCHAIN_BROWSER_USE_BUILD === "1"
            ? "production"
            : "development",
        ...metrics,
      }),
    );
    expect(lockedStartup.includesBuilder).toBe(false);
    expect(deskStartup.includesBuilder).toBe(false);
    expect(buildStartup.includesBuilder).toBe(true);
    expect(studyStartup.includesBuilder).toBe(false);
    expect(lockedStartup.includesStudyReader).toBe(false);
    expect(deskStartup.includesStudyReader).toBe(false);
    expect(studyStartup.includesStudyReader).toBe(true);
    expect(lockedStartup.includesMethodology).toBe(false);
    expect(deskStartup.includesMethodology).toBe(false);
    expect(deskStartup.includesSetupComparison).toBe(false);
    expect(methodologyStartup.includesMethodology).toBe(true);
  } finally {
    await Promise.all([
      locked.close(),
      desk.close(),
      build.close(),
      study.close(),
      methodology.close(),
    ]);
  }
});
