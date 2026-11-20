import { expect, test, type Page } from "./fixtures";
import type { ResearchSessionStart } from "../src/lib/research-sessions";
import type { RecentRunSummary } from "../src/lib/workflow";
import example from "../../../examples/research-workflow.json";

const account = {
  id: "oaiapp_desk_fixture",
  label: "Research fixture",
  signed_in: true,
  plan_enabled: true,
  active: true,
};
async function connection(page: Page) {
  await page.route("**/api/providers/chatgpt", (route) =>
    route.fulfill({
      json: {
        accounts: [account],
        models: [{ slug: "test-model", display_name: "Research fixture" }],
      },
    }),
  );
}

function studySummary(brief: string): RecentRunSummary {
  return {
    id: crypto.randomUUID(),
    revision_id: crypto.randomUUID(),
    revision_number: 1,
    workflow_name: "Research session",
    created_at: new Date().toISOString(),
    status: "completed",
    brief_excerpt: brief,
  };
}

for (const width of [1280, 390]) {
  test(`brief-first research keeps drafts and retries the same launch at ${width}px`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width, height: 920 });
    await connection(page);
    const title = `Desk dataset ${crypto.randomUUID()}`;
    const source = await request.post("/api/evidence", {
      data: {
        id: crypto.randomUUID(),
        title,
        kind: "text",
        rights: "owned",
        text: "Synthetic research data.",
      },
    });
    expect(source.ok()).toBeTruthy();
    const sourceId = (await source.json()).id;
    const recent = studySummary("Can earnings breadth explain the synthetic index recovery?");
    const posts: ResearchSessionStart[] = [];
    await page.route("**/api/research-sessions/*/setup", (route) =>
      route.fulfill({ status: 404, json: { detail: "No session found." } }),
    );
    await page.route("**/api/research-sessions", async (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: [recent] });
      const body = route.request().postDataJSON() as ResearchSessionStart;
      posts.push(body);
      if (posts.length === 1) return route.abort();
      await route.fulfill({
        status: 202,
        json: {
          run_id: body.id,
          command_id: crypto.randomUUID(),
          kind: "start",
          accepted_at: new Date().toISOString(),
        },
      });
    });
    await page.goto("/");
    const brief = page.getByRole("textbox", { name: "Research brief", exact: true });
    const start = page.getByRole("button", { name: "Start research", exact: true });
    await expect(brief).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp("earnings breadth") })).toHaveAttribute(
      "href",
      `/?session=${recent.id}`,
    );
    await expect(page.getByRole("checkbox", { name: "Allow live web search" })).not.toBeChecked();
    await expect(start).toBeDisabled();
    await brief.fill(
      "Trace which synthetic credit series anticipate a rotation and produce a chart.",
    );
    await page.getByRole("link", { name: "Workflows", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Build", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Research desk", exact: true }).click();
    await expect(brief).toHaveValue(/synthetic credit/);
    await page.locator("summary").filter({ hasText: "Writing sample" }).click();
    await page.getByLabel("Import a text or Markdown sample").setInputFiles({
      name: "sample.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("Lead with a concrete observation."),
    });
    await expect(page.getByLabel("Example report excerpt")).toHaveValue(
      "Lead with a concrete observation.",
    );
    await page.locator("summary").filter({ hasText: "Writing sample" }).click();
    await page.locator("summary").filter({ hasText: "Source material" }).click();
    await page.getByRole("searchbox", { name: "Search evidence library" }).fill(title);
    await page.getByRole("checkbox", { name: new RegExp(title) }).check();
    await page.locator("summary").filter({ hasText: "Source material" }).click();
    await page.locator("summary").filter({ hasText: "Research settings" }).click();
    await page.getByLabel("Maximum research agents").selectOption("2");
    await page.getByLabel("Passes per agent").fill("5");
    await page.getByLabel("Active time limit (seconds)").fill("1200");
    await page.getByLabel("Expert review").selectOption("always");
    await page.locator("summary").filter({ hasText: "Research settings" }).click();
    await page.getByLabel("Allow live web search").check();
    await expect(start).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`research-brief-${width}.png`), fullPage: true });
    await start.click();
    await expect(
      page.getByText("This request has no saved session yet.", { exact: false }),
    ).toBeVisible();
    await page.reload();
    await expect(brief).toBeDisabled();
    await expect(page.getByRole("button", { name: "Retry start" })).toBeEnabled();
    expect(posts).toHaveLength(1);
    await page.getByRole("button", { name: "Retry start" }).click();
    await expect(page).toHaveURL(new RegExp(`session=${posts[0]!.id}`));
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
    expect(posts[0]).toMatchObject({
      model: "test-model",
      provider_account_id: account.id,
      evidence_ids: [sourceId],
      max_agents: 2,
      max_passes: 5,
      max_active_seconds: 1200,
      review_mode: "always",
      web_search: true,
      style_excerpt: "Lead with a concrete observation.",
    });
  });
}

test("revise a pinned session setup and recover its accepted start after a lost response", async ({
  page,
}) => {
  await connection(page);
  const previous = crypto.randomUUID();
  const setup = {
    model: "test-model",
    brief: "Use the original horizon.",
    style_excerpt: "Start with the observation.",
    max_agents: 4,
    max_passes: 7,
    max_active_seconds: 1800,
    web_search: false,
    review_mode: "when_needed",
    evidence_ids: [],
  };
  await page.route("**/api/research-sessions/*/setup", (route) => route.fulfill({ json: setup }));
  const admitted: ResearchSessionStart[] = [];
  await page.route("**/api/research-sessions", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: [] });
    admitted.push(route.request().postDataJSON());
    return route.abort();
  });
  await page.goto(`/?fromSession=${previous}`);
  const brief = page.getByLabel("Research brief", { exact: true });
  await expect(brief).toHaveValue(setup.brief);
  await brief.fill("Extend the original horizon.");
  await page.reload();
  await expect(brief).toHaveValue("Extend the original horizon.");
  await page.getByRole("button", { name: "Start research", exact: true }).click();
  await expect.poll(() => admitted.length).toBe(1);
  await expect(page).toHaveURL(new RegExp(`session=${admitted[0]!.id}`));
  expect(admitted[0]).toMatchObject({
    ...setup,
    brief: "Extend the original horizon.",
    baseline_run_id: previous,
  });
  expect(admitted[0]!.id).not.toBe(previous);
});

test("find an older research session in the run archive and return to its workspaces", async ({
  page,
  request,
}) => {
  await connection(page);
  const recent = studySummary("A more recent study.");
  const archived = studySummary("Which funding markets tightened first?");
  const saved = await request.post("/api/revisions", { data: example });
  expect(saved.ok()).toBeTruthy();
  const revision = await saved.json();
  archived.revision_id = revision.id;
  archived.revision_number = revision.number;
  await page.route("**/api/research-sessions", (route) => route.fulfill({ json: [recent] }));
  await page.route("**/api/runs/search?*", (route) =>
    route.fulfill({
      json: {
        items: [{ run: archived, brief_excerpt: archived.brief_excerpt }],
        has_more: false,
      },
    }),
  );
  await page.route(`**/api/runs/${archived.id}`, (route) =>
    route.fulfill({
      json: {
        ...archived,
        workflow: revision.workflow,
        brief: archived.brief_excerpt,
        compiler_version: "research-0.3.0",
        checkpoint_id: null,
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
  await page.goto("/");
  await expect(page.getByRole("link", { name: /more recent study/ })).toBeVisible();
  await expect(page.getByText(archived.brief_excerpt, { exact: true })).toHaveCount(0);
  await page.getByText("Search saved runs", { exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Search the archive" })).toHaveValue(
    "Research session",
  );
  await page.getByRole("link", { name: /Which funding markets tightened first/ }).click();
  const reopen = page.getByRole("link", { name: "Open research session", exact: true });
  await expect(reopen).toHaveAttribute("href", `/?session=${archived.id}`);
  await reopen.click();
  await expect(
    page.getByRole("heading", { name: archived.brief_excerpt, exact: true }),
  ).toBeVisible();
});
