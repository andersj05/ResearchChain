import type { RunSnapshot } from "../src/lib/workflow";
import { expect, test } from "./fixtures";

type Attempt = NonNullable<RunSnapshot["model_attempts"]>[number];
type Result = NonNullable<Attempt["result"]>;

test("finds assignments among 80 researchers by text and live status on a phone", async ({
  page,
}) => {
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  const leads = Array.from({ length: 4 }, (_, index) => ({
    title: `Lead ${index + 1}`,
    objective: `Review data for region ${index + 1}.`,
  }));
  function receipt(path: string, result: Partial<Result>): Attempt {
    return {
      id: crypto.randomUUID(),
      path,
      stage: "custom",
      model: "synthetic",
      status: "completed",
      created_at: now,
      finished_at: now,
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
    };
  }
  const firstReceipt = receipt("root/team/lead-1/agent-1", {
    conclusion: "The first region supplied a saved opening observation.",
  });
  const lastReceipt = receipt("root/team/lead-4/agent-20", {
    conclusion: "The last synthetic cohort supplied its term premium finding.",
  });
  let lastFinished = false;
  const attempts = [
    receipt("root/team/plan", { swarm_plan: { leads } }),
    ...leads.map((_, leadIndex) =>
      receipt(`root/team/lead-${leadIndex + 1}/turn-1`, {
        swarm_action: {
          action: "delegate",
          rationale: "Check each synthetic weekly release.",
          assignments: Array.from({ length: 20 }, (_, index) => ({
            title: `Weekly release ${String(index + 1).padStart(2, "0")}`,
            objective:
              leadIndex === 3 && index === 19
                ? "Compare the term premium for the last release cohort."
                : `Check release ${index + 1} in the synthetic data.`,
          })),
        },
      }),
    ),
    firstReceipt,
  ];
  await page.route(`**/api/runs/${runId}`, (route) =>
    route.fulfill({
      json: {
        id: runId,
        brief: "Review weekly releases across four synthetic regions.",
        created_at: now,
        execution_pending: false,
        status: "running",
        events: [],
        artifacts: [],
        evidence_ids: [],
        workflow: {
          nodes: [
            {
              id: "team",
              config: {
                type: "research",
                team: { swarm: { lead_count: 4, researchers_per_lead: 20 } },
              },
            },
          ],
        },
        research_manifest: {
          settings: { model: "synthetic", limits: { max_model_calls: 100 } },
          evidence: [],
          tool_config: { session: "brief-led-1" },
        },
        model_attempts: [
          ...attempts,
          lastFinished
            ? lastReceipt
            : { ...lastReceipt, status: "requesting", finished_at: null, result: null },
        ],
      },
    }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?session=${runId}&workspace=lead-1%2Fagent-1`);
  const sections = page.getByRole("navigation", { name: "Study sections" });
  const roster = page.getByRole("navigation", { name: "Agent workspaces" });
  const leadTwo = roster.getByRole("region", { name: "Lead 2 team" });
  const search = roster.getByRole("searchbox", { name: "Find a workspace" });
  const workspace = page.locator("#current-research-workspace");
  const matches = roster.getByRole("list", { name: "Matching workspaces" });
  await leadTwo.locator("summary").click();
  await expect(workspace).toContainText(firstReceipt.result!.conclusion);

  await search.fill("weekly release");
  await expect(roster.getByRole("status")).toHaveText("Showing 12 of 80 matching workspaces");
  await expect(matches.getByRole("button")).toHaveCount(12);
  await roster.getByRole("button", { name: "Show 12 more workspaces" }).click();
  await expect(matches.getByRole("button")).toHaveCount(24);
  await expect(matches.getByRole("button").nth(12)).toBeFocused();
  await expect(workspace).toContainText(firstReceipt.result!.conclusion);

  await search.fill("Lead 4 Term Premium");
  await expect(roster.getByRole("status")).toHaveText("1 matching workspace");
  await expect(matches.getByRole("button")).toContainText("Lead 4");
  await search.press("Enter");
  await expect(workspace).toBeFocused();
  await expect(workspace).toContainText("root/team/lead-4/agent-20");
  await expect(matches.getByRole("button")).toHaveAttribute("aria-current", "true");

  await search.fill("missing series");
  await expect(roster.getByRole("status")).toHaveText("No matching workspaces.");
  await expect(workspace).toContainText("root/team/lead-4/agent-20");
  await search.fill("Lead 4 Term Premium");
  await sections.getByRole("link", { name: "Activity log" }).click();
  await page
    .locator("#research-activity")
    .getByRole("button", { name: /Weekly release 01.*Pass 1/ })
    .click();
  await expect(workspace).toBeFocused();
  await expect(workspace).toContainText("root/team/lead-1/agent-1");
  expect(new URL(page.url()).searchParams.get("pass")).toBe(firstReceipt.id);
  await expect(search).toHaveValue("Lead 4 Term Premium");
  await expect(roster.getByText("Open workspace", { exact: true })).toBeVisible();
  const selected = roster.getByRole("button", { name: /^Weekly release 01/ });
  await expect(selected).toHaveAttribute("aria-current", "true");
  await selected.click();
  await expect(workspace).toBeFocused();
  expect(new URL(page.url()).searchParams.get("pass")).toBe(firstReceipt.id);

  await search.press("Escape");
  await expect(search).toBeEmpty();
  await expect(leadTwo.locator("details")).toHaveJSProperty("open", true);

  const status = roster.getByRole("combobox", { name: "Workspace status" });
  await status.selectOption("Active");
  await expect(roster.getByRole("status")).toHaveText("1 matching workspace");
  await expect(matches.getByRole("button")).toContainText("Weekly release 20");
  await expect(workspace).toContainText(firstReceipt.result!.conclusion);
  await search.fill("Lead 3");
  await expect(roster.getByRole("status")).toHaveText("No matching workspaces.");
  await search.fill("Lead 4 term premium");
  await search.press("Enter");
  await expect(workspace).toBeFocused();
  await expect(workspace).toContainText(lastReceipt.path);
  lastFinished = true;
  await expect(roster.getByRole("status")).toHaveText("No matching workspaces.");
  await expect(status).toHaveValue("Active");
  await expect(workspace).toContainText(lastReceipt.result!.conclusion);
  await status.selectOption("Completed");
  await expect(roster.getByRole("status")).toHaveText("1 matching workspace");
  await expect(matches.getByRole("button")).toHaveAttribute("aria-current", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
