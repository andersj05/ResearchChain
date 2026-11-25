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
  return { file, version, reads: () => reads };
}

async function liveStudy(page: Page) {
  const id = crypto.randomUUID();
  const intro = await fileFixture(page, "notes.txt", "Original overview");
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
  const first = attempt(credit, {
    workspace_activity: {
      tool: "run_python",
      summary: "First credit output recorded",
      status: "completed",
      files: [intro.file, earlier.file],
    },
  });
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
  let published = false;
  await page.route(`**/api/runs/${id}`, (route) =>
    route.fulfill({
      json: {
        id,
        brief: "Compare synthetic releases for the two leads.",
        status: "running",
        created_at: createdAt,
        execution_pending: true,
        events: [],
        artifacts: [],
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
          ],
        },
        research_manifest: {
          settings: { model: "synthetic", limits: { max_model_calls: 100 } },
          evidence: [],
          tool_config: { session: "brief-led-1" },
        },
        model_attempts: [plan, ...turns, first, ...(published ? [second, other] : [waiting])],
      },
    }),
  );
  return {
    id,
    first,
    earlier,
    newer,
    foreign,
    publish: () => {
      published = true;
    },
  };
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
    expect(study.earlier.reads()).toBe(1);
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
    expect(study.newer.reads()).toBe(1);
    expect(study.foreign.reads()).toBe(0);
  });
}
