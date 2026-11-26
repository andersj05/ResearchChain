import { pinDeskNote } from "./desk-material";
import { expect, test } from "./fixtures";
import { styleBody } from "./report-fixture";

function savedStudy(title = "Archived credit comparison") {
  const createdAt = "2026-11-24T13:04:00Z";
  const run = {
    id: crypto.randomUUID(),
    revision_id: crypto.randomUUID(),
    revision_number: 1,
    workflow_name: "Research session",
    study_title: title,
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
      workflow: {
        nodes: [
          {
            id: "discovery",
            kind: "research",
            label: "Lead first reading",
            position: { x: 20, y: 20 },
          },
        ],
        edges: [],
      },
      events: [],
      artifacts: [],
      evidence_ids: [],
      model_attempts: attempts,
      research_manifest: {
        account_id: "synthetic-account",
        account_label: "Synthetic connection",
        tool_config: { session: "brief-led-1" },
        evidence: [],
        settings: { model: "test-model", limits: { max_model_calls: 25 } },
      },
    },
  };
}

test("hand off an archived report without replacing the staged setup", async ({
  page,
  context,
}) => {
  const study = savedStudy("Synthetic report handoff archive");
  const artifactId = crypto.randomUUID();
  const markdown = "# Synthetic editorial report\n\nCompare the release dates.";
  const editor = {
    ...study.attempts[0]!,
    id: crypto.randomUUID(),
    path: "root/report",
    result: {
      ...study.attempts[0]!.result,
      workspace_files: [
        {
          name: "report.md",
          artifact_id: artifactId,
          media_type: "text/markdown",
          byte_size: Buffer.byteLength(markdown),
        },
      ],
    },
  };
  await page.route("**/api/runs/search?*", (route) => route.fulfill({ json: study.archive }));
  await context.route(`**/api/runs/${study.run.id}`, (route) =>
    route.fulfill({ json: { ...study.snapshot, model_attempts: [...study.attempts, editor] } }),
  );
  await context.route(`**/api/artifacts/${artifactId}/content`, (route) =>
    route.fulfill({ body: markdown, contentType: "text/markdown" }),
  );
  await context.route("**/api/style-guides", (route) =>
    route.fulfill({
      json: [{ ...styleBody("archived-handoff"), version: 1, created_at: study.run.created_at }],
    }),
  );
  const lookups: string[] = [];
  await context.route("**/api/reports?*", (route) => {
    lookups.push(route.request().url());
    return route.fulfill({ json: [] });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const token = crypto.randomUUID();
  await page.evaluate((value) => Reflect.set(window, "reportHandoffVisit", value), token);
  await page.getByLabel("Usage rights").selectOption("owned");
  await page.getByLabel("Source files").setInputFiles({
    name: "working-release-note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic material for a separate study."),
  });
  const stagedTitle = page.getByLabel("Packet title for working-release-note.txt");
  await stagedTitle.fill("Next release notes");
  const studies = page.getByRole("link", { name: "Studies", exact: true });
  await studies.press("Enter");
  const row = page.getByRole("link", { name: /Synthetic report handoff archive/ });
  await row.press("Enter");
  await page.getByRole("link", { name: "Read report", exact: true }).press("Enter");

  const href = `/?view=reports&fromStudy=${study.run.id}&reportAttempt=${editor.id}`;
  const edit = page.getByRole("link", { name: /^Edit in Reports/ });
  await expect(edit).toHaveAttribute("href", href);
  await expect(edit).toHaveAttribute("target", "_blank");
  await expect(edit).toHaveText("Edit in Reports (new tab)");
  const opened = context.waitForEvent("page");
  await edit.press("Enter");
  const reports = await opened;
  try {
    await expect(reports).toHaveURL(href);
    await expect(reports.getByRole("button", { name: "Create report draft" })).toBeEnabled();
    await expect.poll(() => lookups.length).toBe(1);
    const query = new URL(lookups[0]!).searchParams;
    expect(query.get("study_run_id")).toBe(study.run.id);
    expect(query.get("study_attempt_id")).toBe(editor.id);
  } finally {
    await reports.close();
  }
  await studies.press("Enter");
  await expect(row).toBeFocused();
  await page.getByRole("link", { name: "Return to study setup" }).press("Enter");
  await expect(stagedTitle).toHaveValue("Next release notes");
  expect(await page.evaluate(() => Reflect.get(window, "reportHandoffVisit"))).toBe(token);
});

for (const width of [390, 1440]) {
  test(`keeps the staged setup when comparing a saved revision at ${width}px`, async ({
    page,
    context,
  }) => {
    const revised = savedStudy("Revised credit study");
    const baseline = savedStudy("Original credit study");
    const comparisonHref = `/?view=runs&run=${revised.run.id}&compare=${baseline.run.id}`;
    await page.route("**/api/runs/search?*", (route) => route.fulfill({ json: revised.archive }));
    await context.route(`**/api/runs/${revised.run.id}`, (route) =>
      route.fulfill({ json: { ...revised.snapshot, baseline_run_id: baseline.run.id } }),
    );
    await context.route(`**/api/runs/${baseline.run.id}`, (route) =>
      route.fulfill({ json: baseline.snapshot }),
    );
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const token = crypto.randomUUID();
    await page.evaluate((token) => Reflect.set(window, "comparisonVisitToken", token), token);
    await page.getByLabel("Usage rights").selectOption("owned");
    await page.getByLabel("Source files").setInputFiles({
      name: "follow-up-curve.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("A preliminary synthetic curve observation."),
    });
    const queue = page.getByRole("list", { name: "Files to pin" });
    const title = queue.getByLabel("Packet title for follow-up-curve.txt");
    await title.fill("Follow-up curve notes");

    const studies = page.getByRole("link", { name: "Studies", exact: true });
    await studies.press("Enter");
    const search = page.getByRole("searchbox", { name: "Search the archive" });
    await search.fill("credit study");
    await search.press("Enter");
    const result = page
      .getByRole("list", { name: "Saved studies" })
      .getByRole("link", { name: /Revised credit study/ });
    await result.press("Enter");
    const revisedHeading = page.getByRole("heading", { name: "Revised credit study" });
    await expect(revisedHeading).toBeFocused();
    await expect(queue).toBeHidden();
    const studyUrl = page.url();
    const compare = page.getByRole("link", {
      name: "Compare with baseline (new tab)",
      exact: true,
    });
    await expect(compare).toHaveAttribute("href", comparisonHref);

    const opened = context.waitForEvent("page");
    await compare.press("Enter");
    const comparisonPage = await opened;
    try {
      await comparisonPage.setViewportSize({ width, height: 844 });
      await expect(comparisonPage).toHaveURL(comparisonHref);
      const comparison = comparisonPage.getByRole("region", { name: "Compare saved runs" });
      await expect(comparison.getByLabel("Comparison run")).toHaveValue(baseline.run.id);
      const comparisonTable = comparison.getByRole("region", { name: "Run comparison table" });
      await expect(comparisonTable).toContainText(`Open run · ${revised.run.id.slice(0, 8)}`);
      await expect(comparisonTable).toContainText(
        `Comparison run · ${baseline.run.id.slice(0, 8)}`,
      );
    } finally {
      await comparisonPage.close();
    }
    await page.bringToFront();
    await expect(page).toHaveURL(studyUrl);
    await expect(revisedHeading).toBeVisible();
    await page.getByText("Brief and settings", { exact: true }).click();
    await page.getByRole("link", { name: "Open baseline session", exact: true }).press("Enter");
    const baselineHeading = page.getByRole("heading", { name: "Original credit study" });
    await expect(baselineHeading).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, "comparisonVisitToken"))).toBe(token);
    await expect(baselineHeading).toBeFocused();
    await page.goBack();
    await expect(page).toHaveURL(studyUrl);
    await expect(revisedHeading).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await studies.press("Enter");
    await expect(result).toBeFocused();
    await expect(search).toHaveValue("credit study");
    await page.getByRole("link", { name: "Return to study setup" }).press("Enter");
    await expect(page.getByRole("heading", { name: "New study", exact: true })).toBeVisible();
    await expect(title).toHaveValue("Follow-up curve notes");
    expect(await page.evaluate(() => Reflect.get(window, "comparisonVisitToken"))).toBe(token);
  });
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
    const inspect = pass.getByRole("link", { name: "Inspect pass in Runs (new tab)" });
    await expect(inspect).toHaveAttribute(
      "href",
      `/?view=runs&run=${study.run.id}&attempt=${study.attempts[0]!.id}`,
    );
    await expect(inspect).toHaveAttribute("target", "_blank");
    await expect(page.getByRole("link", { name: "Open run inspector (new tab)" })).toHaveAttribute(
      "href",
      `/?view=runs&run=${study.run.id}`,
    );
    const bookmark = page.url();
    expect(new URL(bookmark).searchParams.get("pass")).toBe(study.attempts[0]!.id);
    expect(new URL(bookmark).hash).toBe("#current-research-workspace");

    await page.goBack();
    await expect(archiveHeading).toBeVisible();
    await expect(search).toHaveValue("credit comparison");
    await expect(result).toBeFocused();
    await page.goBack();
    await expect(title).toHaveValue("New curve note");
    await expect(author).toHaveValue("Synthetic author");
    await page.goForward();
    await expect(archiveHeading).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(bookmark);
    await expect(pass).toContainText("Earlier archive observation.");

    await studies.press("Enter");
    await expect(result).toBeFocused();
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
      await expect(
        separate.getByRole("link", { name: "Inspect pass in Runs", exact: true }),
      ).not.toHaveAttribute("target", "_blank");
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

test("return to the same result and viewport position in a filtered Studies page", async ({
  page,
}) => {
  const study = savedStudy();
  const firstPage = Array.from({ length: 16 }, (_, index) => ({
    run: {
      ...study.run,
      id: crypto.randomUUID(),
      study_title: `Credit study ${index + 1}`,
    },
    brief_excerpt: "Synthetic observations from the study archive.",
  }));
  const secondPage = firstPage.map(({ run, brief_excerpt }, index) => ({
    run: { ...run, id: crypto.randomUUID(), study_title: `Earlier credit study ${index + 1}` },
    brief_excerpt,
  }));
  secondPage.splice(5, 0, study.archive.items[0]!);
  const reads: URLSearchParams[] = [];
  const setupReads: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (
      [
        "/api/evidence",
        "/api/providers/chatgpt",
        "/api/research-sessions",
        "/api/runs/reviews",
      ].includes(pathname)
    )
      setupReads.push(pathname);
  });
  await page.route("**/api/runs/search?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    reads.push(params);
    const paged = params.has("before_id");
    return route.fulfill({ json: { items: paged ? secondPage : firstPage, has_more: !paged } });
  });
  await page.route(`**/api/runs/${study.run.id}`, (route) =>
    route.fulfill({ json: study.snapshot }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=research&studies=1");
  const studies = page.getByRole("link", { name: "Studies", exact: true });
  const search = page.getByRole("searchbox", { name: "Search the archive" });
  const status = page.getByRole("combobox", { name: "Study status" });
  await search.fill("credit");
  await status.selectOption("completed");
  await search.press("Enter");
  await page.getByRole("button", { name: "Next page" }).click();
  const target = page.getByRole("link", { name: new RegExp(study.run.study_title) });
  await expect(target).toBeVisible();
  await target.evaluate((link) => link.scrollIntoView({ block: "center" }));
  const top = (await target.boundingBox())!.y;
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  const reader = page.getByRole("heading", { name: study.run.study_title, exact: true });
  await target.press("Enter");
  await expect(reader).toBeFocused();

  await page.goBack();
  await expect(target).toBeFocused();
  expect(Math.abs((await target.boundingBox())!.y - top)).toBeLessThan(12);
  await expect(search).toHaveValue("credit");
  await expect(status).toHaveValue("completed");
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();

  await target.press("Enter");
  await expect(reader).toBeFocused();
  await studies.press("Enter");
  await expect(target).toBeFocused();
  expect(Math.abs((await target.boundingBox())!.y - top)).toBeLessThan(12);
  expect(setupReads).toEqual([]);
  const pagedReads = reads.filter((params) => params.has("before_id"));
  expect(pagedReads.length).toBeGreaterThan(0);
  for (const params of pagedReads) {
    expect(params.get("search")).toBe("credit");
    expect(params.get("status")).toBe("completed");
    expect(params.get("before_id")).toBe(firstPage.at(-1)!.run.id);
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
