import { createHash } from "node:crypto";
import { expect, test, type Page } from "./fixtures";

const createdAt = "2026-11-25T04:00:00Z";
const credit = "root/team/lead-2/agent-3";
const supply = "root/team/lead-1/agent-1";
const group = "Credit release 3";

function attempt(path: string, result: object, fields: object = {}) {
  return {
    id: crypto.randomUUID(),
    path,
    stage: "custom",
    model: "synthetic",
    status: "completed",
    created_at: createdAt,
    finished_at: createdAt,
    input_bytes: 0,
    output_characters: 0,
    result: {
      schema_version: "research-result-1",
      stage: "custom",
      hypotheses: [],
      unresolved_questions: [],
      evidence_requests: [],
      conclusion: "",
      revision_summary: "",
      limitations: [],
      ...result,
    },
    ...fields,
  };
}

async function fileFixture(page: Page, name: string, version: string, lines = 1) {
  const body = Array.from(
    { length: lines },
    (_, index) => `${version} · synthetic observation ${index + 1}`,
  ).join("\n");
  const file = {
    name,
    media_type: "text/plain",
    byte_size: Buffer.byteLength(body),
    artifact_id: `sha256:${createHash("sha256").update(body).digest("hex")}`,
  };
  let reads = 0;
  await page.route(`**/api/artifacts/${encodeURIComponent(file.artifact_id)}/content*`, (route) => {
    reads += 1;
    return route.fulfill({ body, contentType: "text/plain" });
  });
  await page.route(`**/api/artifacts/${encodeURIComponent(file.artifact_id)}`, (route) =>
    route.fulfill({ json: { ...file, id: file.artifact_id, created_at: createdAt } }),
  );
  return { file, version, reads: () => reads };
}

async function liveStudy(page: Page) {
  const id = crypto.randomUUID();
  const intro = await fileFixture(page, "notes.txt", "Original overview");
  const original = await fileFixture(page, "Release source.txt", "Pinned original file");
  const request = await fileFixture(page, "request.json", "Saved model request");
  const earlier = await fileFixture(page, "analysis.txt", "First immutable credit result", 180);
  const newer = await fileFixture(page, "analysis.txt", "New credit result", 150);
  const foreign = await fileFixture(page, "analysis.txt", "Other team's result", 120);
  const leads = ["Supply", "Credit"].map((title) => ({
    title,
    objective: `Review weekly ${title.toLowerCase()} data.`,
  }));
  const plan = attempt("root/team/plan", { swarm_plan: { leads } });
  const turns = leads.map(({ title }, index) =>
    attempt(`root/team/lead-${index + 1}/turn-1`, {
      swarm_action: {
        action: "delegate",
        rationale: "Check the synthetic weekly releases independently.",
        assignments: Array.from({ length: 8 }, (_, release) => ({
          title: `${title} release ${release + 1}`,
          objective: `Check release ${release + 1} for revisions in the synthetic series.`,
        })),
      },
    }),
  );
  const first = attempt(
    credit,
    {
      workspace_activity: {
        tool: "run_python",
        summary: "First credit output recorded",
        status: "completed",
        files: [intro.file, earlier.file],
      },
    },
    { input_artifact_id: request.file.artifact_id, input_bytes: request.file.byte_size },
  );
  const secondPath = `${credit}/analyst-pass-2`;
  const waiting = attempt(
    secondPath,
    {},
    { status: "requesting", result: null, finished_at: null },
  );
  const second = attempt(
    secondPath,
    {
      workspace_activity: {
        tool: "run_python",
        summary: "Second credit output recorded",
        status: "completed",
        files: [newer.file],
      },
    },
    { id: waiting.id },
  );
  const other = attempt(supply, {
    workspace_activity: {
      tool: "run_python",
      summary: "Supply output recorded",
      status: "completed",
      files: [foreign.file],
    },
  });
  const restored = attempt(`${credit}/analyst-pass-3`, { workspace_files: [earlier.file] });
  const perspective = {
    action_path: "root/team/lead-2/turn-2",
    lead_title: "Credit",
    thesis: "Funding timing could explain the revisions.",
    question: "Which funding baseline should the study use?",
    options: ["Opening estimates", "Revised estimates"],
    worker_paths: [first.path],
  };
  const consultation = attempt(perspective.action_path, {
    swarm_action: { action: "ask_expert", consultation: perspective },
  });
  const reviewId = crypto.randomUUID();
  let published = false;
  let restore = false;
  let consult = false;
  let editorial = false;
  await page.route(`**/api/runs/${id}`, (route) =>
    route.fulfill({
      json: {
        id,
        brief: "Compare synthetic releases for the two leads.",
        status: consult || editorial ? "paused" : "running",
        created_at: createdAt,
        execution_pending: !consult && !editorial,
        checkpoint_id: consult || editorial ? "synthetic-checkpoint" : null,
        events: [],
        artifacts: [
          {
            id: original.file.artifact_id,
            name: original.file.name,
            media_type: original.file.media_type,
          },
        ],
        evidence_ids: [],
        workflow: {
          nodes: [
            {
              id: "team",
              config: {
                type: "research",
                team: { swarm: { lead_count: 2, researchers_per_lead: 8 } },
              },
            },
            { id: "judgment", config: { type: "human_review" } },
          ],
        },
        reviews: consult
          ? [
              {
                interrupt_id: reviewId,
                node_id: "team",
                path: "root/team",
                question: perspective.question,
                perspective,
              },
            ]
          : editorial
            ? [
                {
                  interrupt_id: reviewId,
                  node_id: "judgment",
                  path: "root/judgment",
                  question: "Which findings should the report emphasize?",
                },
              ]
            : [],
        research_manifest: {
          settings: { model: "synthetic", limits: { max_model_calls: 100 } },
          evidence: [],
          tool_config: { session: "brief-led-1" },
        },
        model_attempts: [
          plan,
          ...turns,
          first,
          ...(published ? [second, other] : [waiting]),
          ...(restore ? [restored] : []),
          ...(consult ? [consultation] : []),
        ],
      },
    }),
  );
  return {
    id,
    restored,
    earlier,
    newer,
    foreign,
    original,
    request,
    reviewId,
    publish: () => {
      published = true;
    },
    restore: () => {
      restore = true;
    },
    consult: () => {
      consult = true;
    },
    editorialReview: () => {
      consult = false;
      editorial = true;
    },
  };
}

test("navigates the live swarm graph from a lead to a researcher and to review", async ({
  page,
}) => {
  const study = await liveStudy(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?session=${study.id}&workspace=director`);
  await page
    .getByRole("navigation", { name: "Study sections" })
    .getByRole("link", { name: "Team graph" })
    .click();
  const graph = page.getByRole("region", { name: "Team graph" });
  const director = graph.getByRole("link", { name: /^Swarm director/ });
  await expect(director).toHaveAttribute("aria-current", "true");
  await expect(director).toContainText("Completed");
  const credit = graph.getByRole("listitem", { name: "Credit lead team", exact: true });
  await expect(credit).toContainText("Waiting for researchers");
  await expect(credit.locator("summary")).toContainText("1 active");
  await expect(credit.getByRole("link", { name: /^Credit release 3/ })).toHaveCount(0);
  await credit.locator("summary").press("Enter");
  const researcher = credit.getByRole("link", { name: /^Credit release 3/ });
  await expect(researcher).toContainText("Active");
  await researcher.press("Enter");
  const workspace = page.getByRole("region", { name: `${group} workspace`, exact: true });
  await expect(workspace).toBeFocused();
  await expect(researcher).toHaveAttribute("aria-current", "true");
  study.publish();
  await expect(researcher).toContainText("Queued");
  await expect(workspace).toContainText("Second credit output recorded");
  study.consult();
  const answer = graph.getByRole("link", { name: "Answer Credit", exact: true });
  await expect(answer).toBeVisible();
  await answer.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#consultation-${study.reviewId}$`));
  await expect(
    page.getByRole("region", { name: "Credit requests your perspective" }),
  ).toBeVisible();
  study.editorialReview();
  const review = graph.getByRole("link", { name: "Editorial judgment Awaiting your judgment" });
  await expect(review).toBeVisible({ timeout: 10000 });
  await review.press("Enter");
  await expect(page).toHaveURL(/#editorial-review$/);
  await expect(page.getByRole("region", { name: "Your judgment", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const width of [390, 1440]) {
  test(`explore workspace files, originals and receipts with exact version selection at ${width}px`, async ({
    page,
  }) => {
    const study = await liveStudy(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/?session=${study.id}&workspace=director`);
    await page.getByRole("link", { name: "Saved files", exact: true }).click();
    const tree = page.getByRole("navigation", { name: "Study file tree" });
    const viewer = page.getByRole("region", { name: "Study file preview" });
    const source = tree.getByRole("button", { name: study.original.file.name, exact: true });
    expect(study.original.reads()).toBe(0);
    await source.press("Enter");
    await expect(viewer.locator("pre")).toContainText(study.original.version);
    await expect(viewer.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      `/api/artifacts/${encodeURIComponent(study.original.file.artifact_id)}/content`,
    );
    if (width < 681) {
      await expect(viewer.getByRole("heading", { name: study.original.file.name })).toBeFocused();
      await viewer.getByRole("button", { name: "Back to file tree" }).press("Enter");
      await expect(source).toBeFocused();
    }
    await tree
      .locator("summary")
      .filter({ has: page.getByText("Credit", { exact: true }) })
      .press("Enter");
    await tree
      .locator("summary")
      .filter({ has: page.getByText(group, { exact: true }) })
      .press("Enter");
    await tree
      .locator("summary")
      .filter({ has: page.getByText("Model receipts", { exact: true }) })
      .press("Enter");
    await tree.getByRole("button", { name: "request-1.json" }).press("Enter");
    await expect(viewer.locator("pre")).toContainText(study.request.version);
    const search = tree.getByRole("searchbox", { name: "Search all files" });
    await search.fill("analysis.txt credit release");
    const file = tree.getByRole("button", { name: /^analysis\.txt/ });
    await expect(file).toHaveCount(1);
    await file.press("Enter");
    await expect(viewer.locator("pre")).toContainText(study.earlier.version);
    await expect(viewer).toContainText("Credit / Credit release 3");
    if (width > 680) await expect(file).toBeFocused();
    study.publish();
    const versions = viewer.getByRole("combobox", { name: "Saved version" });
    await expect(versions.locator("option:checked")).toHaveText("Version 1 · Pass 1");
    await expect(viewer.locator("pre")).toContainText(study.earlier.version);
    expect(study.newer.reads()).toBe(0);
    expect(study.foreign.reads()).toBe(0);
    if (width > 680) await expect(file).toBeFocused();
    await versions.selectOption({ label: "Latest · Pass 2" });
    await expect(viewer.locator("pre")).toContainText(study.newer.version);
    study.restore();
    await expect(versions.locator("option:checked")).toHaveText("Version 2 · Pass 2");
    await expect(viewer.locator("pre")).toContainText(study.newer.version);
    await versions.selectOption({ label: "Latest · Pass 3" });
    await expect(viewer.locator("pre")).toContainText(study.earlier.version);
    await expect(viewer.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      `/api/artifacts/${encodeURIComponent(study.earlier.file.artifact_id)}/content?filename=analysis.txt`,
    );
    const savedPass = viewer.getByRole("link", { name: "Open saved pass" });
    await savedPass.press("Enter");
    const workspace = page.getByRole("region", { name: `${group} workspace`, exact: true });
    await expect(workspace).toBeFocused();
    expect(new URL(page.url()).searchParams.get("pass")).toBe(study.restored.id);
    await page.getByRole("button", { name: "Recent versions", exact: true }).click();
    await workspace.getByRole("link", { name: "Back to saved files" }).click();
    await expect(savedPass).toBeFocused();
    await expect(search).toHaveValue("analysis.txt credit release");
    await expect(viewer.locator("pre")).toContainText(study.earlier.version);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

for (const width of [390, 1440]) {
  test(`keep the selected team file open while a newer version arrives at ${width}px`, async ({
    page,
  }) => {
    const study = await liveStudy(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/?session=${study.id}`);
    const sections = page.getByRole("navigation", { name: "Study sections" });
    const roster = page.getByRole("navigation", { name: "Agent workspaces" });
    await sections.getByRole("link", { name: "Workspaces", exact: true }).click();
    const lookup = roster.getByRole("searchbox", { name: "Find a workspace" });
    await lookup.fill(group);
    await lookup.press("Enter");
    const workspace = page.getByRole("region", { name: `${group} workspace`, exact: true });
    const files = workspace.getByRole("region", { name: "Workspace files", exact: true });
    const selector = files.getByRole("combobox", { name: "Preview workspace file" });
    const preview = files.locator("pre");
    const download = files.getByRole("link", { name: "Download analysis.txt", exact: true });
    await expect(workspace).toContainText("First credit output recorded");
    await expect(selector).toHaveValue("notes.txt");
    await selector.selectOption("analysis.txt");
    await expect(preview).toContainText(study.earlier.version);
    const earlierReads = study.earlier.reads();
    await preview.evaluate((element) => {
      element.scrollTop = 580;
    });
    await sections.getByRole("link", { name: "Activity log", exact: true }).click();
    const activity = page.getByRole("searchbox", { name: "Search study activity" });
    await activity.fill(group);
    await sections.getByRole("link", { name: "Workspaces", exact: true }).click();
    await expect(selector).toHaveValue("analysis.txt");
    expect(await preview.evaluate((element) => element.scrollTop)).toBe(580);
    await preview.focus();
    const before = await preview.evaluate((element) => ({
      scroll: element.scrollTop,
      focused: element === document.activeElement,
    }));
    expect(before).toEqual({ scroll: 580, focused: true });
    const earlierHref = `/api/artifacts/${encodeURIComponent(study.earlier.file.artifact_id)}/content?filename=analysis.txt`;
    await expect(download).toHaveAttribute("href", earlierHref);
    study.publish();
    await expect(workspace).toContainText("Second credit output recorded");
    const openLatest = files.getByRole("button", { name: "Open latest version", exact: true });
    await expect(openLatest).toBeVisible();
    await expect(preview).toContainText(study.earlier.version);
    await expect(selector).toHaveValue("analysis.txt");
    await expect(preview).toBeFocused();
    expect(await preview.evaluate((element) => element.scrollTop)).toBe(580);
    await expect(download).toHaveAttribute("href", earlierHref);
    expect(study.earlier.reads()).toBe(earlierReads);
    expect(study.newer.reads()).toBe(0);
    expect(new URL(page.url()).searchParams.get("workspace")).toBe("lead-2/agent-3");
    await openLatest.press("Enter");
    await expect(selector).toBeFocused();
    await expect(preview).toContainText(study.newer.version);
    await expect(download).toHaveAttribute(
      "href",
      `/api/artifacts/${encodeURIComponent(study.newer.file.artifact_id)}/content?filename=analysis.txt`,
    );
    await expect(openLatest).toHaveCount(0);
    expect(study.newer.reads()).toBeGreaterThan(0);
    expect(study.foreign.reads()).toBe(0);
  });
}
