import { commissionDeskStudy, pinDeskNote } from "./desk-material";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import type { RunSnapshot } from "../src/lib/workflow";

test("follow two research leads from queued work through an expert consultation and a revised study", async ({
  page,
  request,
}, info) => {
  test.setTimeout(210_000);
  const fixture = process.env.RESEARCHCHAIN_ACCESS_DIRECTORY;
  if (!fixture) throw new Error("Run the isolated browser-test runner.");
  const id = crypto.randomUUID();
  const answer = "Focus on inventories and challenge the timing.";
  await page.setViewportSize({ width: 1280, height: 920 });
  await page.goto("/");
  await pinDeskNote(page);
  await page
    .getByLabel("Context for the lead (optional)", { exact: true })
    .fill(`Swarm browser study ${id}`);
  const settings = page.locator("summary").filter({ hasText: "Research settings" });

  await page.getByLabel("Team structure").selectOption("swarm");
  await expect(page.getByRole("combobox", { name: "Research leads", exact: true })).toHaveValue(
    "2",
  );
  await expect(page.getByLabel("Researchers per lead")).toHaveValue("20");
  await page.getByLabel("Researchers per lead").fill("3");

  await page.getByLabel("Active slots", { exact: true }).fill("1");
  await page.getByLabel("Turns per lead").fill("4");
  await page.getByLabel("Passes per agent").fill("3");
  await page.getByLabel("Editorial review").selectOption("never");
  await expect(page.getByLabel("Allow leads to ask for expert judgment")).toBeChecked();
  const sharedModel = page.getByRole("combobox", { name: "Research model", exact: true });
  const shared = page.getByRole("group", { name: "Shared response settings", exact: true });
  await expect(sharedModel).toHaveValue("gpt-6.2-sol");
  await expect(shared.getByRole("slider", { name: "Thinking effort" })).toHaveAttribute(
    "aria-valuetext",
    "High",
  );
  await expect(shared.getByRole("slider", { name: "Response detail" })).toHaveAttribute(
    "aria-valuetext",
    "High",
  );
  await expect(
    page.getByRole("combobox", { name: "Research lead model", exact: true }),
  ).toHaveValue("gpt-6.2-astra");
  await expect(page.getByRole("combobox", { name: "Researchers model", exact: true })).toHaveValue(
    "gpt-6.2-sol",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await settings.locator("..").screenshot({ path: info.outputPath("phone-swarm-controls.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 920 });
  await page.getByRole("button", { name: "Ask the lead for a first reading", exact: true }).click();
  await expect(page).toHaveURL(/session=[\da-f-]{36}/);
  await commissionDeskStudy(page, "Compare demand and supply timing across the two releases.");
  const runId = new URL(page.url()).searchParams.get("session")!;
  const roster = page.getByRole("navigation", { name: "Agent workspaces" });
  const demand = roster.getByRole("region", { name: "Demand team" });
  try {
    await expect(demand.locator("summary")).toContainText("1 active · 1 queued", {
      timeout: 85_000,
    });
    const children = demand.locator("details");
    if (!(await children.evaluate((element) => element.hasAttribute("open"))))
      await demand.locator("summary").click();
    const queued = children.getByRole("button", { name: /Queued/ });
    await expect(queued).toHaveCount(1);
    await queued.click();
    await expect(page).toHaveURL(/workspace=lead-1%2Fagent-/);
    await expect(page.locator("#current-research-workspace")).toContainText("Queued");
    await expect(page.locator("#current-research-workspace")).toContainText("gpt-6.2-sol");
    await page.screenshot({ path: info.outputPath("swarm-queue.png") });
  } finally {
    await writeFile(
      join(fixture, `swarm-observed-${id}`),
      "The browser observed queued researcher work.",
    );
  }
  const consultation = page.getByRole("region", { name: "Supply requests your perspective" });
  await expect(consultation).toContainText(
    "Which supply constraint should guide the trade thesis?",
    { timeout: 65_000 },
  );
  await expect(consultation).toContainText("Working thesis");
  await consultation.getByRole("button", { name: "Inventories", exact: true }).click();
  const perspective = consultation.getByLabel("Your perspective", { exact: true });
  await expect(perspective).toHaveValue("Inventories");
  await perspective.fill(answer);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(perspective).toHaveValue(answer);
  await consultation.getByRole("link", { name: "Inspect the lead’s work" }).click();
  await expect(page.locator("#current-research-workspace")).toContainText("root/team/lead-2");
  await expect(page).toHaveURL(/workspace=lead-2.*pass=/);
  await consultation.getByRole("button", { name: "Send perspective to lead" }).click();
  await page
    .getByText("Recorded expert perspectives (1)", { exact: true })
    .click({ timeout: 60_000 });
  await expect(page.getByText(answer, { exact: true })).toBeVisible();
  const next = page.getByRole("link", { name: "Lead’s next turn" });
  await expect(next).toBeVisible({ timeout: 60_000 });
  const followUp = page.getByRole("region", { name: "Assignments after your perspective" });
  await expect(followUp).toContainText("Inventory timing", { timeout: 60_000 });
  await expect(followUp).not.toContainText("Backlog");
  await next.click();
  await expect(page.locator("#current-research-workspace")).toContainText("Inventory timing");
  await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Completed", {
    timeout: 65_000,
  });
  await roster.getByRole("button", { name: /^Report editor/ }).click();
  await expect(
    page
      .locator("#current-research-workspace")
      .getByRole("heading", { name: "Synthetic swarm report" }),
  ).toBeVisible();
  const run: RunSnapshot = await (await request.get(`/api/runs/${runId}`)).json();
  expect(run.perspective_answers).toEqual([
    expect.objectContaining({ feedback: answer, action_path: "root/team/lead-2/turn-1" }),
  ]);
  expect(run.research_manifest?.settings).toMatchObject({
    model: "gpt-6.2-sol",
    reasoning_effort: "high",
    verbosity: "high",
    limits: { max_model_calls: 31 },
  });
  expect(run.workflow.nodes.find((node) => node.id === "team")?.config).toMatchObject({
    team: { lead: { model: "gpt-6.2-astra" }, researcher: { model: "gpt-6.2-sol" } },
  });
  const attempts = run.model_attempts!;
  for (const expected of [
    "root/team/plan",
    "root/team/lead-1/turn-1",
    "root/team/lead-1/agent-1",
    "root/report",
  ]) {
    expect(attempts.map((attempt) => attempt.path)).toContain(expected);
  }
  await Promise.all(
    attempts.map(async (attempt) => {
      const lead =
        ["root/discovery", "root/team/plan"].includes(attempt.path) ||
        /\/turn-\d+$/.test(attempt.path);
      const model = lead ? "gpt-6.2-astra" : "gpt-6.2-sol";
      expect(attempt.model, attempt.path).toBe(model);
      const input = await request.get(
        `/api/artifacts/${encodeURIComponent(attempt.input_artifact_id!)}/content`,
      );
      expect(input.ok(), attempt.path).toBeTruthy();
      expect(await input.json(), attempt.path).toMatchObject({
        model,
        reasoning: { effort: "high" },
        text: { verbosity: "high" },
      });
    }),
  );
  const follow = run.model_attempts?.find((turn) => turn.path === "root/team/lead-2/agent-1");
  expect(follow?.model).toBe("gpt-6.2-sol");
  expect(follow?.input_artifact_id).toBeTruthy();
  const supply = roster.getByRole("region", { name: "Supply team" });
  await supply.locator("summary").click();
  await supply.getByRole("button", { name: /^Inventory timing/ }).click();
  const detail = page.locator("#current-research-workspace");
  await detail.locator("summary").filter({ hasText: "Model passes" }).click();
  await detail.getByLabel("Inspect model pass").selectOption(follow!.id);
  const saved = await detail.getByRole("link", { name: "Saved request" }).getAttribute("href");
  const packet = await (await request.get(saved!)).json();
  expect(JSON.stringify(packet.input)).toContain(answer);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Revisit material" }).click();

  await expect(page.getByLabel("Team structure")).toHaveValue("swarm");
  await expect(page.getByLabel("Researchers per lead")).toHaveValue("3");
  await expect(sharedModel).toHaveValue("gpt-6.2-sol");
  await expect(shared.getByRole("slider", { name: "Thinking effort" })).toHaveAttribute(
    "aria-valuetext",
    "High",
  );
  await expect(shared.getByRole("slider", { name: "Response detail" })).toHaveAttribute(
    "aria-valuetext",
    "High",
  );
  await expect(
    page.getByRole("combobox", { name: "Research lead model", exact: true }),
  ).toHaveValue("gpt-6.2-astra");
  await expect(page.getByRole("combobox", { name: "Researchers model", exact: true })).toHaveValue(
    "gpt-6.2-sol",
  );
  await expect(page.getByLabel("Editorial review")).toHaveValue("never");
});

test("the swarm preset preserves unavailable requested models and lets the owner choose replacements", async ({
  page,
}) => {
  await page.route("**/api/providers/chatgpt", (route) =>
    route.fulfill({
      json: {
        accounts: [
          {
            id: "oaiapp_swarm_fixture",
            label: "Swarm fixture",
            active: true,
            signed_in: true,
            plan_enabled: true,
          },
        ],
        models: [
          { slug: "verified-fixture", display_name: "Verified fixture", supports_verbosity: false },
        ],
      },
    }),
  );
  await page.goto("/");
  await pinDeskNote(page);
  await page
    .getByLabel("Context for the lead (optional)", { exact: true })
    .fill("Test an explicit model replacement.");

  const topology = page.getByLabel("Team structure");
  const start = page.getByRole("button", { name: "Ask the lead for a first reading", exact: true });
  const lead = page.getByRole("combobox", { name: "Research lead model", exact: true });
  const worker = page.getByRole("combobox", { name: "Researchers model", exact: true });
  await expect(topology).toHaveValue("standard");

  await expect(lead.locator("option:checked")).toHaveText("gpt-6.2-astra (unavailable)");
  await expect(worker.locator("option:checked")).toHaveText("gpt-6.2-sol (unavailable)");
  await expect(start).toBeDisabled();
  await topology.selectOption("swarm");
  await expect(lead.locator("option:checked")).toHaveText("gpt-6.2-astra (unavailable)");
  await expect(worker.locator("option:checked")).toHaveText("gpt-6.2-sol (unavailable)");
  await expect(start).toBeDisabled();
  await lead.selectOption("verified-fixture");
  await expect(start).toBeDisabled();
  await worker.selectOption("verified-fixture");
  await expect(start).toBeEnabled();
  await topology.selectOption("standard");
  await expect(page.getByLabel("Maximum research agents")).toHaveValue("3");
  await topology.selectOption("swarm");
  await expect(lead).toHaveValue("verified-fixture");
  await expect(worker).toHaveValue("verified-fixture");
  await page.reload();

  await expect(topology).toHaveValue("swarm");
  await expect(lead).toHaveValue("verified-fixture");
});

test("separate lead consultations retain their own drafts, supporting receipts and answers on a phone", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  const titles = ["Demand timing", "Supply timing"];
  const mandates = titles.map((title) => ({
    title,
    objective: `Inspect ${title.toLowerCase()} in the synthetic series.`,
  }));
  const questions = titles.map((title, i) => {
    const path = `root/team/lead-${i + 1}`;
    const question = `Which observation should guide ${title.toLowerCase()}?`;
    return {
      node_id: "team",
      path: path + "/turn-2",
      interrupt_id: crypto.randomUUID(),
      question,
      perspective: {
        lead_title: title,
        action_path: path + "/turn-2",
        question,
        thesis: `${title} could change the conclusion.`,
        options: i ? ["Earlier release", "Later release"] : [],
        worker_paths: [path + "/agent-1"],
      },
    };
  });
  function receipt(path: string, model: string, result: object) {
    return {
      id: crypto.randomUUID(),
      path,
      model,
      result: { limitations: [], ...result },
      status: "completed",
      created_at: now,
      finished_at: now,
      input_bytes: 0,
      output_characters: 0,
    };
  }
  const attempts = [
    receipt("root/team/plan", "gpt-6.2-astra", { swarm_plan: { leads: mandates } }),
  ];
  for (const [i, q] of questions.entries()) {
    const path = `root/team/lead-${i + 1}`;
    attempts.push(
      receipt(path + "/turn-1", "gpt-6.2-astra", {
        swarm_action: {
          action: "delegate",
          rationale: "Find the archived release.",
          assignments: [{ title: "Release check", objective: "Inspect the saved release." }],
        },
      }),
      receipt(path + "/agent-1", "gpt-6.2-sol", {
        conclusion: `Receipt for ${q.perspective.lead_title}.`,
      }),
      receipt(path + "/turn-2", "gpt-6.2-astra", {
        swarm_action: { action: "ask_expert", consultation: q.perspective },
      }),
    );
  }
  const answers: NonNullable<RunSnapshot["perspective_answers"]> = [];
  await page.route(`**/api/runs/${runId}`, (route) => {
    const pending = questions.filter(
      (q) => !answers.some((answer) => answer.interrupt_id === q.interrupt_id),
    );
    return route.fulfill({
      json: {
        id: runId,
        brief: "Compare two synthetic release schedules.",
        created_at: now,
        execution_pending: false,
        status: pending.length ? "paused" : "running",
        checkpoint_id: "checkpoint-" + answers.length,
        reviews: pending,
        review: pending[0] ?? null,
        perspective_answers: answers,
        events: [],
        artifacts: [],
        evidence_ids: [],
        workflow: {
          nodes: [
            {
              id: "team",
              config: {
                type: "research",
                team: {
                  swarm: { lead_count: 2 },
                  lead: { model: "gpt-6.2-astra" },
                  researcher: { model: "gpt-6.2-sol" },
                },
              },
            },
          ],
        },
        research_manifest: {
          settings: { model: "gpt-6.2-astra", limits: { max_model_calls: 60 } },
          evidence: [],
          tool_config: { session: "brief-led-1", model_settings_version: "model-settings-1" },
        },
        model_attempts: attempts,
      },
    });
  });
  await page.route(`**/api/runs/${runId}/resume`, (route) => {
    const body = route.request().postDataJSON();
    const match = questions.find((q) => q.interrupt_id === body.interrupt_id);
    expect(match).toBeDefined();
    expect(body.checkpoint_id).toBe("checkpoint-" + answers.length);
    answers.push({
      action_path: match!.path,
      interrupt_id: body.interrupt_id,
      decision: body.decision,
      feedback: body.feedback,
    });
    return route.fulfill({ status: 202, json: { run_id: runId } });
  });
  await page.goto(`/?session=${runId}`);
  const demand = page.getByRole("region", { name: "Demand timing requests your perspective" });
  const supply = page.getByRole("region", { name: "Supply timing requests your perspective" });
  await expect(demand.getByRole("group", { name: "Suggested perspectives" })).toHaveCount(0);
  await demand.getByLabel("Your perspective").fill("Hold the first observation fixed.");
  await supply.getByRole("button", { name: "Later release", exact: true }).click();
  await page.reload();
  await expect(demand.getByLabel("Your perspective")).toHaveValue(
    "Hold the first observation fixed.",
  );
  await expect(supply.getByLabel("Your perspective")).toHaveValue("Later release");
  await supply.getByRole("link", { name: "Release check · Pass 1" }).click();
  await expect(page).toHaveURL(/workspace=lead-2%2Fagent-1/);
  await expect(page.locator("#current-research-workspace")).toContainText(
    "Receipt for Supply timing.",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: info.outputPath("phone-consultations-and-leads.png"),
    fullPage: true,
  });
  await supply.getByRole("button", { name: "Send perspective to lead" }).click();
  await expect(supply).toHaveCount(0);
  await expect(demand.getByLabel("Your perspective")).toHaveValue(
    "Hold the first observation fixed.",
  );
  await page.reload();
  await expect(demand.getByLabel("Your perspective")).toHaveValue(
    "Hold the first observation fixed.",
  );
  await demand.getByRole("button", { name: "Send perspective to lead" }).click();
  await expect
    .poll(() => answers.map((answer) => answer.action_path))
    .toEqual(["root/team/lead-2/turn-2", "root/team/lead-1/turn-2"]);
  await page.getByText("Recorded expert perspectives (2)", { exact: true }).click();
  await expect(page.getByText("Later release", { exact: true })).toBeVisible();
});
