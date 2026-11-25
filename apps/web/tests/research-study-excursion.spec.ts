import { pinDeskNote } from "./desk-material";
import { expect, test } from "./fixtures";

function savedStudy() {
  const createdAt = "2026-11-24T13:04:00Z";
  const run = {
    id: crypto.randomUUID(),
    revision_id: crypto.randomUUID(),
    revision_number: 1,
    workflow_name: "Research session",
    study_title: "Archived credit comparison",
    status: "completed",
    created_at: createdAt,
  };
  const attempts = ["Earlier", "Later"].map((label) => ({
    id: crypto.randomUUID(),
    path: "root/discovery",
    status: "completed",
    stage: "custom",
    model: "synthetic",
    created_at: createdAt,
    result: {
      schema_version: "research-result-1",
      stage: "custom",
      hypotheses: [],
      unresolved_questions: [],
      evidence_requests: [],
      conclusion: `${label} archive observation.`,
      revision_summary: "",
      limitations: [],
    },
  }));
  return {
    run,
    attempts,
    archive: {
      items: [{ run, brief_excerpt: "Synthetic observations from the earlier study." }],
      has_more: false,
    },
    snapshot: {
      ...run,
      brief: "Archive fixture for comparing two saved passes.",
      execution_pending: false,
      workflow: { nodes: [] },
      events: [],
      artifacts: [],
      evidence_ids: [],
      model_attempts: attempts,
      research_manifest: {
        tool_config: { session: "brief-led-1" },
        evidence: [],
        settings: { model: "test-model", limits: { max_model_calls: 25 } },
      },
    },
  };
}

test("inspect an archived study and its exact pass without losing the staged setup", async ({
  page,
  context,
}) => {
  const study = savedStudy();
  const readerUrl = `/?session=${study.run.id}`;
  const release = Promise.withResolvers<void>();
  await page.route("**/api/runs/search?*", (route) => route.fulfill({ json: study.archive }));
  await context.route(`**/api/runs/${study.run.id}`, async (route) => {
    await release.promise;
    await route.fulfill({ json: study.snapshot });
  });

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const token = crypto.randomUUID();
    await page.evaluate((token) => Reflect.set(window, "studyExcursionToken", token), token);
    await page.getByLabel("Usage rights").selectOption("owned");
    await page.getByLabel("Source files").setInputFiles({
      name: "new-curve-note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic observations for the next study."),
    });
    const queue = page.getByRole("list", { name: "Files to pin" });
    const title = queue.getByLabel("Packet title for new-curve-note.txt");
    await title.fill("New curve note");
    await queue.locator("summary").click();
    const author = queue.getByLabel("Author / speaker");
    await author.fill("Synthetic author");

    const studies = page.getByRole("link", { name: "Studies", exact: true });
    const archiveHeading = page.getByRole("heading", { name: "Studies", exact: true });
    const readerHeading = page.getByRole("heading", { name: study.run.study_title, exact: true });
    await studies.press("Enter");
    const search = page.getByRole("searchbox", { name: "Search the archive" });
    await search.fill("credit comparison");
    await search.press("Enter");
    const result = page
      .getByRole("list", { name: "Saved studies" })
      .getByRole("link", { name: new RegExp(study.run.study_title) });
    await expect(result).toHaveAttribute("href", readerUrl);
    await result.press("Enter");
    await expect(page).toHaveURL(readerUrl);
    await expect(page.getByText("Opening the research session…")).toBeVisible();
    await expect(queue).toBeHidden();
    release.resolve();
    await expect(readerHeading).toBeFocused();

    const activity = page.locator("#research-activity");
    await activity.locator("summary").click();
    await activity.getByRole("button", { name: /Research lead.*Pass 1/ }).click();
    const pass = page.getByRole("region", { name: "Pass 1", exact: true });
    await expect(pass).toContainText("Earlier archive observation.");
    const bookmark = page.url();
    expect(new URL(bookmark).searchParams.get("pass")).toBe(study.attempts[0]!.id);
    expect(new URL(bookmark).hash).toBe("#current-research-workspace");

    await page.goBack();
    await expect(archiveHeading).toBeVisible();
    await expect(search).toHaveValue("credit comparison");
    await page.goBack();
    await expect(title).toHaveValue("New curve note");
    await expect(author).toHaveValue("Synthetic author");
    await page.goForward();
    await expect(archiveHeading).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(bookmark);
    await expect(pass).toContainText("Earlier archive observation.");

    await studies.press("Enter");
    await expect(archiveHeading).toBeFocused();
    await expect(search).toHaveValue("credit comparison");
    const opened = context.waitForEvent("page");
    await result.click({ modifiers: ["ControlOrMeta"] });
    const separate = await opened;
    try {
      await separate.bringToFront();
      await expect(separate).toHaveURL(readerUrl);
      await expect(separate.getByRole("heading", { name: study.run.study_title })).toBeVisible();
      await expect(page).toHaveURL(/studies=1/);
      await separate.goto(bookmark);
      await expect(separate.getByRole("region", { name: "Pass 1", exact: true })).toContainText(
        "Earlier archive observation.",
      );
      await expect(separate.getByRole("list", { name: "Files to pin" })).toHaveCount(0);
    } finally {
      await separate.close();
    }

    await result.click();
    await expect(readerHeading).toBeFocused();
    await page.getByRole("link", { name: "Research desk", exact: true }).press("Enter");
    await expect(page.getByRole("heading", { name: "New study", exact: true })).toBeFocused();
    await expect(title).toHaveValue("New curve note");
    await expect(author).toHaveValue("Synthetic author");
    expect(await page.evaluate(() => Reflect.get(window, "studyExcursionToken"))).toBe(token);
  } finally {
    release.resolve();
  }
});

test("a pending admission stays on the exact draft while an archived study is open", async ({
  page,
}) => {
  const saved = savedStudy();
  const admittedId = Promise.withResolvers<string>();
  const release = Promise.withResolvers<void>();
  const setupReads: string[] = [];
  await page.route("**/api/research-sessions/*/setup", (route) => {
    setupReads.push(route.request().url());
    return route.fulfill({ status: 404, json: { detail: "No synthetic setup read expected." } });
  });
  await page.route("**/api/runs/search?*", (route) => route.fulfill({ json: saved.archive }));
  await page.route(`**/api/runs/${saved.run.id}`, (route) =>
    route.fulfill({ json: saved.snapshot }),
  );
  await page.route("**/api/research-sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const id = route.request().postDataJSON().id as string;
    admittedId.resolve(id);
    await release.promise;
    await route.fulfill({
      status: 202,
      json: {
        run_id: id,
        command_id: crypto.randomUUID(),
        accepted_at: new Date().toISOString(),
        kind: "start",
      },
    });
  });

  try {
    await page.goto("/");
    await pinDeskNote(page);
    await page.getByRole("button", { name: "Ask the lead for a first reading" }).click();
    const id = await admittedId.promise;
    await page.getByRole("link", { name: "Studies", exact: true }).click();
    await page.getByRole("link", { name: new RegExp(saved.run.study_title) }).click();
    await expect(page.getByRole("heading", { name: saved.run.study_title })).toBeVisible();
    const receipt = page.waitForResponse(
      (response) => response.url().endsWith("/api/research-sessions") && response.status() === 202,
    );
    release.resolve();
    await (await receipt).finished();
    await expect(page).toHaveURL(`/?session=${saved.run.id}`);

    await page.getByRole("link", { name: "Research desk", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Study started", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open study", exact: true })).toHaveAttribute(
      "href",
      `/?session=${id}`,
    );
    expect(setupReads).toEqual([]);
  } finally {
    release.resolve();
  }
});
