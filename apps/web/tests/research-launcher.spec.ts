import { pinDeskNote } from "./desk-material";
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

async function connection(
  page: Page,
  models: ProviderModel[] = [
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
    ...["gpt-6.2-astra", "gpt-6.2-sol"].map((slug): ProviderModel => ({
      slug,
      display_name: slug,
      reasoning_efforts: ["low", "medium", "high", "xhigh"],
      default_reasoning_effort: "medium",
      supports_verbosity: true,
      default_verbosity: "medium",
    })),
  ],
) {
  await page.route("**/api/providers/chatgpt", (route) =>
    route.fulfill({ json: { accounts: [account], models } }),
  );
}

async function submittedSetup(
  page: Page,
  buttonName = "Ask the lead for a first reading",
): Promise<ResearchSessionStart> {
  await pinDeskNote(page);
  await page.route("**/api/research-sessions", (route) =>
    route.request().method() === "POST" ? route.abort() : route.fulfill({ json: [] }),
  );
  const captured = page.waitForRequest(
    (request) =>
      request.method() === "POST" && new URL(request.url()).pathname === "/api/research-sessions",
  );
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  return (await captured).postDataJSON();
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
  test(`source-first research keeps drafts and retries the same launch at ${width}px`, async ({
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
    const brief = page.getByRole("textbox", {
      name: "Context for the lead (optional)",
      exact: true,
    });
    const start = page.getByRole("button", {
      name: "Ask the lead for a first reading",
      exact: true,
    });
    await expect(brief).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp("earnings breadth") })).toHaveAttribute(
      "href",
      `/?session=${recent.id}`,
    );
    await expect(page.getByRole("checkbox", { name: "Allow live web search" })).toBeChecked();
    await expect(start).toBeDisabled();
    await brief.fill(
      "Trace which synthetic credit series anticipate a rotation and produce a chart.",
    );
    await page.getByRole("link", { name: "Workflows", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Build", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Research desk", exact: true }).click();
    await expect(brief).toHaveValue(/synthetic credit/);

    await page.getByLabel("Import a text or Markdown sample").setInputFiles({
      name: "sample.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("Lead with a concrete observation."),
    });
    await expect(page.getByLabel("Example report excerpt")).toHaveValue(
      "Lead with a concrete observation.",
    );

    await page.getByRole("searchbox", { name: "Search evidence library" }).fill(title);
    await page.getByRole("checkbox", { name: new RegExp(title) }).check();

    await page.getByLabel("Research leads").selectOption("3");
    await page.getByText("Optional execution limits", { exact: true }).click();
    await page.getByLabel("Passes per agent").fill("5");
    await page.getByLabel("Active time limit (seconds)").fill("1200");
    await page
      .getByRole("combobox", { name: "Research model", exact: true })
      .selectOption("test-model");
    const shared = page.getByRole("group", { name: "Shared response settings", exact: true });
    const effort = shared.getByRole("slider", { name: "Thinking effort", exact: true });
    const detail = shared.getByRole("slider", { name: "Response detail", exact: true });
    const detailControl = shared.getByRole("group", {
      name: "Response detail control",
      exact: true,
    });
    await expect(effort).toHaveAttribute("aria-valuetext", "High");
    await expect(detail).toHaveAttribute("aria-valuetext", "High");
    // This account advertises only Medium and High, regardless of levels supported by other models.
    await expect(effort).toHaveAttribute("min", "0");
    await expect(effort).toHaveAttribute("max", "1");
    await effort.focus();
    await effort.press("Home");
    await expect(effort).toBeFocused();
    await expect(effort).toHaveAttribute("aria-valuetext", "Medium");
    await effort.press("ArrowRight");
    await expect(effort).toHaveAttribute("aria-valuetext", "High");
    const modelDefault = detailControl.getByRole("button", {
      name: "Use model default",
      exact: true,
    });
    await modelDefault.click();
    await expect(modelDefault).toHaveAttribute("aria-pressed", "true");
    await expect(detailControl.getByText("Model default · Low", { exact: true })).toBeVisible();
    await expect(detail).toHaveAttribute("aria-valuetext", "Model default · Low");
    await detail.press("End");
    await expect(modelDefault).toHaveAttribute("aria-pressed", "false");
    await expect(detail).toHaveAttribute("aria-valuetext", "High");

    const lead = page.getByRole("group", { name: "Research lead", exact: true });
    const researchers = page.getByRole("group", { name: "Researchers", exact: true });
    await expect(lead.getByRole("combobox", { name: "Research lead model" })).toHaveValue(
      "gpt-6.2-astra",
    );
    await expect(researchers.getByRole("combobox", { name: "Researchers model" })).toHaveValue(
      "gpt-6.2-sol",
    );
    await expect(researchers.getByRole("slider", { name: "Thinking effort" })).toHaveAttribute(
      "aria-valuetext",
      "Shared · High",
    );
    if (width === 390) {
      await page.getByLabel("Editorial review").selectOption("never");
      const expanded = page.getByRole("region", { name: "Research settings", exact: true });
      for (const phoneWidth of [320, width]) {
        await page.setViewportSize({ width: phoneWidth, height: 920 });
        const clipped = await expanded.locator("select:visible").evaluateAll((controls) => {
          const context = document.createElement("canvas").getContext("2d")!;
          return controls.flatMap((element) => {
            const select = element as HTMLSelectElement;
            const style = getComputedStyle(select);
            const text = select.selectedOptions[0]!.text;
            context.font = [style.fontWeight, style.fontSize, style.fontFamily].join(" ");
            // Reserve the select's padding and native dropdown arrow.
            const interior =
              select.clientWidth -
              parseFloat(style.paddingLeft) -
              parseFloat(style.paddingRight) -
              16;
            return context.measureText(text).width > interior ? [text] : [];
          });
        });
        expect(clipped, `Selected settings at ${phoneWidth}px`).toEqual([]);
        const sliders = expanded.getByRole("slider");
        await expect(sliders).toHaveCount(8);
        const outsideViewport = await sliders.evaluateAll((items) =>
          items.flatMap((item) => {
            const bounds = item.getBoundingClientRect();
            return bounds.width <= 0 || bounds.left < 0 || bounds.right > innerWidth
              ? [item.id]
              : [];
          }),
        );
        expect(outsideViewport, `Slider bounds at ${phoneWidth}px`).toEqual([]);
      }
    }
    await page.getByLabel("Editorial review").selectOption("always");
    await researchers
      .getByRole("combobox", { name: "Researchers model" })
      .selectOption("compact-model");
    await expect(start).toBeDisabled();
    await expect(
      page.getByRole("complementary", { name: "Prepare the first reading" }).getByRole("alert"),
    ).toContainText("Researchers");
    const researcherEffort = researchers.getByRole("slider", { name: "Thinking effort" });
    const researcherDetail = researchers.getByRole("slider", { name: "Response detail" });
    await expect(researcherEffort).toHaveAttribute("min", "0");
    await expect(researcherEffort).toHaveAttribute("max", "0");
    await researcherEffort.press("Home");
    await expect(researcherEffort).toHaveAttribute("aria-valuetext", "Low");
    await expect(researcherDetail).toBeDisabled();
    await researchers
      .getByRole("group", { name: "Response detail control" })
      .getByRole("button", { name: "Use model default" })
      .click();
    await expect(researcherDetail).toHaveAttribute("aria-valuetext", "Model default");
    const editorDetail = page
      .getByRole("group", { name: "Report editor", exact: true })
      .getByRole("slider", { name: "Response detail", exact: true });
    await editorDetail.press("Home");
    await editorDetail.press("ArrowRight");
    await expect(editorDetail).toHaveAttribute("aria-valuetext", "Medium");
    await expect(start).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    await page.getByLabel("Allow live web search").check();
    await expect(start).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`research-packet-${width}.png`),
      fullPage: true,
    });
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
      lead: { model: "gpt-6.2-astra" },
      researcher: { model: "compact-model", reasoning_effort: "low", verbosity: "model_default" },
      editor: { model: "gpt-6.2-astra", verbosity: "medium" },
      provider_account_id: account.id,
      evidence_ids: [sourceId],
      start_from_sources: true,
      max_input_bytes: 8_000_000,
      swarm: { lead_count: 3 },
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
    const brief = page.getByLabel("Context for the lead (optional)", { exact: true });
    await expect(brief).toHaveValue(setup.brief);
    const evidenceId = await pinDeskNote(page);
    await brief.fill("Extend the original horizon.");
    await page.reload();
    await expect(brief).toHaveValue("Extend the original horizon.");
    await expect(
      page.getByRole("button", { name: "Ask the lead for a first reading", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("complementary", { name: "Prepare the first reading" }).getByRole("alert"),
    ).toContainText("retired-model");

    const lead = page.getByRole("group", { name: "Research lead", exact: true });
    const model = lead.getByRole("combobox", { name: "Research lead model" });
    const effort = lead.getByRole("slider", { name: "Thinking effort", exact: true });
    await expect(model.locator("option:checked")).toHaveText("retired-model (unavailable)");
    await model.selectOption("test-model");
    await expect(effort).toHaveAttribute("aria-valuetext", "Ultra (unavailable)");
    await expect(effort).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByRole("button", { name: "Ask the lead for a first reading", exact: true }),
    ).toBeDisabled();
    await effort.press("Home");
    await expect(effort).toHaveAttribute("aria-valuetext", "Medium");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page
      .getByRole("button", { name: "Ask the lead for a first reading", exact: true })
      .click();
    await expect.poll(() => admitted.length).toBe(1);
    await expect(page).toHaveURL(new RegExp(`session=${admitted[0]!.id}`));
    expect(admitted[0]).toMatchObject({
      ...setup,
      evidence_ids: [evidenceId],
      start_from_sources: true,
      lead: { ...setup.lead, model: "test-model", reasoning_effort: "medium" },
      brief: "Extend the original horizon.",
      baseline_run_id: previous,
    });
    expect(admitted[0]!.researcher).toBeFalsy();
    expect(admitted[0]!.id).not.toBe(previous);
  });
}

for (const highRole of ["gpt-6.2-sol", "gpt-6.2-astra"]) {
  test(`a fresh team requests High only on models that advertise it (${highRole})`, async ({
    page,
  }) => {
    await connection(
      page,
      ["gpt-6.2-astra", "gpt-6.2-sol"].map((slug) => ({
        slug,
        display_name: slug,
        reasoning_efforts: slug === highRole ? ["low", "high"] : ["low"],
        default_reasoning_effort: "low",
        supports_verbosity: slug === highRole,
      })),
    );
    await page.goto("/");
    await page
      .getByLabel("Context for the lead (optional)", { exact: true })
      .fill("Compare the supplied series.");

    const shared = page.getByRole("group", { name: "Shared response settings", exact: true });
    const lead = page.getByRole("group", { name: "Research lead", exact: true });
    const sharedHigh = highRole === "gpt-6.2-sol";
    await expect(shared.getByRole("slider", { name: "Thinking effort" })).toHaveAttribute(
      "aria-valuetext",
      sharedHigh ? "High" : "Model default · Low",
    );
    await expect(lead.getByRole("slider", { name: "Thinking effort" })).toHaveAttribute(
      "aria-valuetext",
      sharedHigh ? "Model default · Low" : "High",
    );
    await expect(lead.getByRole("slider", { name: "Response detail" })).toHaveAttribute(
      "aria-valuetext",
      sharedHigh ? "Model default" : "High",
    );
    const setup = await submittedSetup(page);
    expect(setup.model).toBe("gpt-6.2-sol");
    expect(setup.reasoning_effort ?? null).toBe(sharedHigh ? "high" : null);
    expect(setup.verbosity ?? null).toBe(sharedHigh ? "high" : null);
    expect(setup.lead).toMatchObject({
      model: "gpt-6.2-astra",
      reasoning_effort: sharedHigh ? "model_default" : "high",
      verbosity: sharedHigh ? "model_default" : "high",
    });
    expect(setup.researcher?.model).toBe("gpt-6.2-sol");
    expect(setup.editor).toEqual(setup.lead);
  });
}

// Exact pre-preset blank from an older open tab. Keep the fixture independent of current defaults.
const oldBlank = {
  brief: "",
  style_excerpt: "",
  model: "",
  evidence_ids: [],
  max_agents: 3,
  max_passes: 6,
  max_active_seconds: 1800,
  web_search: false,
  review_mode: "when_needed",
} as const;

for (const scenario of ["untouched", "in progress", "explicit defaults", "pending"] as const) {
  test(`restore a pre-slider tab with ${scenario} setup`, async ({ page, ownerSession }) => {
    await connection(page);
    const draft = {
      ...oldBlank,
      ...(scenario === "in progress" ? { brief: "Keep the original defaults." } : {}),
      ...(scenario === "pending"
        ? { model: "test-model", brief: "Retry the original request exactly." }
        : {}),
      ...(scenario === "explicit defaults"
        ? {
            model: "test-model",
            reasoning_effort: null,
            verbosity: null,
            lead: { reasoning_effort: "model_default" },
            researcher: null,
            editor: null,
          }
        : {}),
    };
    const pending =
      scenario === "pending"
        ? {
            ...draft,
            id: crypto.randomUUID(),
            provider_account_id: account.id,
          }
        : null;
    const key = `${ownerSession.prefix}.research-brief.new`;
    await page.addInitScript(
      ({ key, record }) => {
        if (sessionStorage.getItem(key) === null)
          sessionStorage.setItem(key, JSON.stringify(record));
      },
      { key, record: { draft, pending } },
    );
    await page.route("**/api/research-sessions/*/setup", (route) =>
      route.fulfill({ status: 404, json: { detail: "No session found." } }),
    );
    await page.goto("/");
    if (pending) {
      await expect(page.getByRole("button", { name: "Retry start" })).toBeDisabled();
      await page.getByRole("button", { name: "Edit setup" }).click();
      const replacement = await submittedSetup(page);
      expect(replacement.brief).toBe(pending.brief);
      expect(replacement.id).not.toBe(pending.id);
      expect(replacement.start_from_sources).toBe(true);
      return;
    }
    const brief = page.getByLabel("Context for the lead (optional)", { exact: true });
    await expect(brief).toHaveValue(draft.brief);
    await brief.fill("Submit the restored research settings.");
    const setup = await submittedSetup(page);
    if (scenario === "untouched") {
      expect(setup).toMatchObject({
        model: "gpt-6.2-sol",
        reasoning_effort: "high",
        verbosity: "high",
        lead: { model: "gpt-6.2-astra" },
        researcher: { model: "gpt-6.2-sol" },
        editor: { model: "gpt-6.2-astra" },
        swarm: { max_lead_turns: null, allow_consultations: true },
        max_passes: null,
        max_active_seconds: null,
        web_search: true,
      });
    } else {
      expect(setup.model).toBe("test-model");
      expect(setup.reasoning_effort ?? null).toBeNull();
      expect(setup.verbosity ?? null).toBeNull();
      expect(setup.researcher?.model).toBeUndefined();
      expect(setup.lead?.model).toBeUndefined();
      if (scenario === "explicit defaults") {
        expect(setup.lead?.reasoning_effort).toBe("model_default");
      }
    }
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
  const archivedRequest = page.waitForRequest(
    (request) => new URL(request.url()).searchParams.get("sessions_only") === "true",
  );
  await page.getByText("Search past studies", { exact: true }).click();
  await archivedRequest;
  await expect(page.getByRole("searchbox", { name: "Search the archive" })).toHaveValue("");
  const reopen = page.getByRole("link", { name: /Which funding markets tightened first/ });
  await expect(reopen).toHaveAttribute("href", `/?session=${archived.id}`);
  await reopen.click();
  await expect(
    page.getByRole("heading", { name: archived.brief_excerpt, exact: true }),
  ).toBeVisible();
});
