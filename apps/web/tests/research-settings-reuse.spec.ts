import { pinDeskNote } from "./desk-material";
import { expect, test } from "./fixtures";
import type { ResearchSessionSetup, ResearchSessionStart } from "../src/lib/research-sessions";

test("reuse saved research settings in an independent new study draft", async ({ page }) => {
  const studyId = crypto.randomUUID();
  const previousSourceId = crypto.randomUUID();
  const settings = {
    model: "test-model",
    reasoning_effort: "medium",
    verbosity: "high",
    lead: { model: "analysis-model", reasoning_effort: "high", verbosity: "low" },
    researcher: { model: "test-model", reasoning_effort: "model_default" },
    editor: { model: "analysis-model", verbosity: "model_default" },
    swarm: {
      lead_count: 3,
      researchers_per_lead: 4,
      max_parallel: 5,
      max_lead_turns: 7,
      allow_consultations: false,
    },
    max_input_bytes: 2_000_000,
    max_agents: 4,
    max_passes: 9,
    max_active_seconds: 1500,
  } as const;
  const previous: ResearchSessionSetup = {
    ...settings,
    brief: "Check last week's inventory release.",
    title: "Previous inventory study",
    start_from_sources: true,
    style_excerpt: "Previous writing sample.",
    evidence_ids: [previousSourceId],
    baseline_run_id: crypto.randomUUID(),
    web_search: false,
    review_mode: "never",
  };
  const requested = Promise.withResolvers<void>();
  const releaseSetup = Promise.withResolvers<void>();
  const submitted = Promise.withResolvers<ResearchSessionStart>();
  const releaseStart = Promise.withResolvers<void>();
  let holdSetup = false;
  let recentReads = 0;
  let setupReads = 0;
  let catalogReads = 0;
  let starts = 0;

  await page.route(`**/api/research-sessions/${studyId}/setup`, async (route) => {
    setupReads++;
    if (holdSetup) {
      requested.resolve();
      await releaseSetup.promise;
    }
    await route.fulfill({ json: previous });
  });
  await page.route("**/api/research-sessions", async (route) => {
    if (route.request().method() === "GET") {
      recentReads++;
      return route.fulfill({
        json: [
          {
            id: studyId,
            study_title: previous.title,
            status: "completed",
            workflow_name: "Research session",
            created_at: "2026-11-24T10:00:00Z",
          },
        ],
      });
    }
    starts++;
    submitted.resolve(route.request().postDataJSON() as ResearchSessionStart);
    await releaseStart.promise;
    await route.fulfill({ status: 422, json: { detail: "Synthetic start captured." } });
  });
  await page.route(`**/api/evidence/${previousSourceId}`, (route) =>
    route.fulfill({
      json: {
        id: previousSourceId,
        title: "Prior inventory figures",
        kind: "text",
        representation: "original",
        availability: "available",
      },
    }),
  );
  await page.route("**/api/providers/chatgpt", (route) => {
    catalogReads++;
    return route.fulfill({
      json: {
        accounts: [
          {
            id: "oaiapp_settings_fixture",
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
    });
  });

  const revisionUrl = `/?fromSession=${studyId}`;
  const title = page.getByLabel("Study title (optional)", { exact: true });
  const context = page.getByLabel("Context for the lead (optional)", { exact: true });
  const sample = page.getByLabel("Example report excerpt", { exact: true });
  const passes = page.getByLabel("Passes per agent", { exact: true });
  const packet = page.getByRole("list", { name: "Pinned material", exact: true });
  const reuse = page.getByText("Use settings from a study", { exact: true });
  const choice = page.getByRole("combobox", { name: "Saved study", exact: true });
  const apply = page.getByRole("button", { name: "Use these settings", exact: true });
  const start = page.getByRole("button", { name: "Ask the lead for a first reading" });
  const web = page.getByRole("checkbox", { name: "Allow live web search" });
  const editorial = page.getByRole("combobox", { name: "Editorial review", exact: true });
  const newTitle = "Next inventory reading";
  const newContext = "Study this week's updated turnover.";
  const newSample = "Summarize the release dates first.";

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(revisionUrl);
    await expect(title).toHaveValue(previous.title!);
    await expect(packet).toContainText("Prior inventory figures");
    await expect(reuse).toHaveCount(0);
    await title.fill("Revision draft only");
    await passes.fill("7");
    await page.reload();
    await expect(title).toHaveValue("Revision draft only");
    await expect(passes).toHaveValue("7");

    await page.goto("/");
    await expect(title).toHaveValue("");
    await expect(context).toHaveValue("");
    await expect(sample).toHaveValue("");
    await expect(packet).toHaveCount(0);
    const model = page.getByRole("combobox", { name: "Research model", exact: true });
    await expect(model).toBeEnabled();
    await reuse.click();
    const throughOpening = { recentReads, setupReads, catalogReads };
    await expect(apply).toBeDisabled();
    holdSetup = true;
    await choice.selectOption(studyId);
    await requested.promise;
    await expect(apply).toBeDisabled();

    await title.fill(newTitle);
    await context.fill(newContext);
    await sample.fill(newSample);
    await passes.fill("8");
    await web.check();
    await editorial.selectOption("always");
    await page.getByLabel("Usage rights").selectOption("owned");
    await page.getByLabel("Source files").setInputFiles({
      name: "next-week-observation.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("A new observation staged while loading settings."),
    });
    const queue = page.getByRole("list", { name: "Files to pin" });
    await expect(queue.getByLabel("Packet title for next-week-observation.txt")).toBeVisible();
    releaseSetup.resolve();
    await expect(apply).toBeEnabled();
    await expect(passes).toHaveValue("8");
    await apply.click();
    await expect(page.getByText("Research settings copied.", { exact: true })).toBeVisible();
    await expect(passes).toHaveValue("9");
    await expect(page.getByRole("combobox", { name: "Research leads", exact: true })).toHaveValue(
      "3",
    );
    await expect(model).toHaveValue("test-model");
    await expect(
      page.getByRole("combobox", { name: "Research lead model", exact: true }),
    ).toHaveValue("analysis-model");
    await expect(title).toHaveValue(newTitle);
    await expect(context).toHaveValue(newContext);
    await expect(sample).toHaveValue(newSample);
    await expect(queue.getByLabel("Packet title for next-week-observation.txt")).toBeVisible();
    await expect(packet).toHaveCount(0);
    await expect(web).toBeChecked();
    await expect(editorial).toHaveValue("always");
    await expect(start).toBeDisabled();
    expect(starts).toBe(0);
    expect({ recentReads, setupReads, catalogReads }).toEqual({
      ...throughOpening,
      setupReads: throughOpening.setupReads + 1,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    await page.reload();
    await expect(passes).toHaveValue("9");
    await expect(title).toHaveValue(newTitle);
    await page.goto(revisionUrl);
    await expect(title).toHaveValue("Revision draft only");
    await expect(passes).toHaveValue("7");
    await expect(packet).toContainText("Prior inventory figures");
    await page.goto("/");
    await expect(passes).toHaveValue("9");
    const newSourceId = await pinDeskNote(page);
    await reuse.click();
    await start.click();
    const request = await submitted.promise;
    await expect(choice).toBeDisabled();
    expect(request).toMatchObject({
      ...settings,
      title: newTitle,
      brief: newContext,
      style_excerpt: newSample,
      evidence_ids: [newSourceId],
      provider_account_id: "oaiapp_settings_fixture",
      review_mode: "always",
      web_search: true,
      start_from_sources: true,
    });
    expect(request).not.toHaveProperty("baseline_run_id");
    releaseStart.resolve();
    await expect(
      page.getByRole("alert").filter({ hasText: "Synthetic start captured." }),
    ).toBeVisible();
  } finally {
    releaseSetup.resolve();
    releaseStart.resolve();
  }
});
