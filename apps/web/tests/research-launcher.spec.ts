import { expect, test, type Page } from "./fixtures";
import type { ResearchSessionStart } from "../src/lib/research-sessions";
import type { RecentRunSummary } from "../src/lib/workflow";
import {
  sessionModelProblem,
  stepModelProblem,
  type ModelProfile,
  type ModelOverride,
  type ProviderModel,
} from "../src/lib/model-settings";
import example from "../../../examples/research-workflow.json";

const account = {
  id: "oaiapp_desk_fixture",
  label: "Research fixture",
  signed_in: true,
  plan_enabled: true,
  active: true,
};

test("only settings used by an executable research role constrain admission", () => {
  const models: ProviderModel[] = [
    {
      slug: "limited",
      display_name: "Limited",
      reasoning_efforts: ["low"],
      supports_verbosity: false,
    },
  ];
  const shared: ModelProfile = { model: "limited", reasoning_effort: "high", verbosity: "high" };
  const override: ModelOverride = { reasoning_effort: "low", verbosity: "model_default" };
  const roles = { lead: override, researcher: override, editor: override };
  expect(sessionModelProblem(models, shared, roles)).toBe("");
  expect(sessionModelProblem(models, { ...shared, model: "retired" }, roles)).toContain("retired");
  expect(sessionModelProblem(models, shared, { ...roles, lead: null })).toContain("Research lead");
  expect(
    stepModelProblem(models, shared, {
      team: { max_agents: 2, lead: override, researcher: override },
    }),
  ).toBe("");
  expect(stepModelProblem(models, shared, { team: { max_agents: 2, lead: override } })).toContain(
    "Researchers",
  );
  expect(stepModelProblem(models, shared, {})).toContain("High thinking effort");
});

async function connection(page: Page) {
  await page.route("**/api/providers/chatgpt", (route) =>
    route.fulfill({
      json: {
        accounts: [account],
        models: [
          {
            slug: "test-model",
            display_name: "Research fixture",
            reasoning_efforts: ["medium", "high"],
            default_reasoning_effort: "medium",
            supports_verbosity: true,
            default_verbosity: "low",
          },
          {
            slug: "compact-model",
            display_name: "Compact fixture",
            reasoning_efforts: ["low"],
            default_reasoning_effort: "low",
            supports_verbosity: false,
          },
        ],
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
    const shared = page.getByRole("group", { name: "Shared response settings", exact: true });
    const effort = shared.getByRole("combobox", { name: "Thinking effort" });
    const detail = shared.getByRole("combobox", { name: "Response detail" });
    await expect(effort.locator("option:checked")).toHaveText("Model default · Medium");
    await expect(detail.locator("option:checked")).toHaveText("Model default · Low");
    await expect(effort.getByRole("option", { name: "Ultra", exact: true })).toHaveCount(0);
    await effort.selectOption("high");
    await detail.selectOption("high");
    await page.locator("summary").filter({ hasText: "Models by role" }).click();
    const researchers = page.getByRole("group", { name: "Researchers", exact: true });
    await researchers
      .getByRole("combobox", { name: "Researchers model" })
      .selectOption("compact-model");
    await expect(start).toBeDisabled();
    await expect(page.locator("form").getByRole("alert")).toContainText("Researchers");
    const researcherEffort = researchers.getByRole("combobox", { name: "Thinking effort" });
    const researcherDetail = researchers.getByRole("combobox", { name: "Response detail" });
    await expect(researcherEffort.getByRole("option", { name: "High", exact: true })).toHaveCount(
      0,
    );
    await researcherEffort.selectOption("low");
    await expect(researcherDetail.locator("option")).toHaveCount(2);
    await researcherDetail.selectOption("model_default");
    await page
      .getByRole("group", { name: "Report editor", exact: true })
      .getByRole("combobox", { name: "Response detail" })
      .selectOption("medium");
    await expect(start).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
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
      reasoning_effort: "high",
      verbosity: "high",
      researcher: { model: "compact-model", reasoning_effort: "low", verbosity: "model_default" },
      editor: { verbosity: "medium" },
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

for (const width of [1280, 390]) {
  test(`revise a pinned session setup and recover its accepted start after a lost response at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await connection(page);
    const previous = crypto.randomUUID();
    const setup = {
      model: "test-model",
      reasoning_effort: "high",
      verbosity: "low",
      lead: { model: "retired-model", reasoning_effort: "ultra", verbosity: "model_default" },
      editor: { verbosity: "medium" },
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
    await expect(page.getByRole("button", { name: "Start research", exact: true })).toBeDisabled();
    await expect(page.locator("form").getByRole("alert")).toContainText("retired-model");
    await page.locator("summary").filter({ hasText: "Research settings" }).click();
    await page.locator("summary").filter({ hasText: "Models by role" }).click();
    const lead = page.getByRole("group", { name: "Research lead", exact: true });
    const model = lead.getByRole("combobox", { name: "Research lead model" });
    const effort = lead.getByRole("combobox", { name: "Thinking effort" });
    await expect(model.locator("option:checked")).toHaveText("retired-model (unavailable)");
    await model.selectOption("test-model");
    await expect(effort.locator("option:checked")).toHaveText("Ultra (unavailable)");
    await expect(page.getByRole("button", { name: "Start research", exact: true })).toBeDisabled();
    await effort.selectOption("medium");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole("button", { name: "Start research", exact: true }).click();
    await expect.poll(() => admitted.length).toBe(1);
    await expect(page).toHaveURL(new RegExp(`session=${admitted[0]!.id}`));
    expect(admitted[0]).toMatchObject({
      ...setup,
      lead: { ...setup.lead, model: "test-model", reasoning_effort: "medium" },
      brief: "Extend the original horizon.",
      baseline_run_id: previous,
    });
    expect(admitted[0]!.id).not.toBe(previous);
  });
}

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
