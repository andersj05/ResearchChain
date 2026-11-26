import type { RunSnapshot } from "../src/lib/workflow";
import { expect, test, type Page } from "./fixtures";

type Attempt = NonNullable<RunSnapshot["model_attempts"]>[number];
type Result = NonNullable<Attempt["result"]>;
const primary = "Should we weight the final synthetic release?";
const secondary = "Which release vintage belongs in the comparison?";
const question = `${primary}\n${secondary}`;
const now = "2026-11-24T20:00:00Z";

function receipt(
  path: string,
  result: Partial<Result>,
  status: Attempt["status"] = "completed",
): Attempt {
  return {
    id: crypto.randomUUID(),
    path,
    stage: "custom",
    model: "synthetic",
    status,
    created_at: now,
    finished_at: status === "completed" ? now : null,
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

async function openJudgment(
  page: Page,
  attempts: Attempt[],
  swarm?: { lead_count: number; researchers_per_lead: number },
) {
  const runId = crypto.randomUUID();
  const checkpoint = crypto.randomUUID();
  const review = {
    node_id: "judgment",
    path: "root/judgment",
    interrupt_id: crypto.randomUUID(),
    question,
  };
  const submitted: unknown[] = [];
  await page.route(`**/api/runs/${runId}/resume`, (route) => {
    submitted.push(route.request().postDataJSON());
    return route.fulfill({ status: 202, json: { run_id: runId } });
  });
  await page.route(`**/api/runs/${runId}`, (route) =>
    route.fulfill({
      json: {
        id: runId,
        brief: "Review synthetic release weights.",
        created_at: now,
        status: submitted.length ? "running" : "paused",
        execution_pending: false,
        checkpoint_id: checkpoint,
        review: submitted.length ? null : review,
        events: [],
        artifacts: [],
        workflow: { nodes: [{ id: "team", config: { type: "research", team: { swarm } } }] },
        research_manifest: {
          settings: { model: "synthetic", limits: { max_model_calls: 100 } },
          evidence: [],
          tool_config: { session: "brief-led-1" },
        },
        model_attempts: attempts,
      },
    }),
  );
  await page.goto(`/?session=${runId}`);
  return {
    review,
    checkpoint,
    submitted,
    panel: page.getByRole("region", { name: "Your judgment" }),
  };
}

const pythonResult: Partial<Result> = {
  conclusion: "Synthetic intermediate tool result.",
  workspace_activity: {
    tool: "run_python",
    status: "completed",
    summary: "Saved scratch data.",
    output: "",
    files: [],
  },
};

test("browse a large editorial handoff and return to the same unsent judgment", async ({
  page,
}) => {
  const leads = Array.from({ length: 4 }, (_, index) => ({
    title: `Lead ${index + 1}`,
    objective: `Review release region ${index + 1}.`,
  }));
  const assignments = Array.from({ length: 20 }, (_, index) => ({
    title: `Weekly release ${String(index + 1).padStart(2, "0")}`,
    objective: `Check release ${index + 1} in the synthetic data.`,
  }));
  const target = "root/team/lead-4/agent-20";
  const final = receipt(`${target}/analyst-pass-3`, {
    conclusion: "The final saved comparison supports keeping the original weights.",
    review_question: primary,
  });
  const attempts = [
    receipt("root/team/plan", { swarm_plan: { leads } }),
    ...leads.flatMap((_, leadIndex) => {
      const lead = `root/team/lead-${leadIndex + 1}`;
      return [
        receipt(`${lead}/turn-1`, {
          swarm_action: { action: "delegate", rationale: "Trace each release.", assignments },
        }),
        ...assignments.flatMap((_, index) => {
          const worker = `${lead}/agent-${index + 1}`;
          if (worker === target)
            return [
              receipt(worker, {
                conclusion: "A provisional weighting check.",
                next_lead: "Check the revised data.",
              }),
              receipt(`${worker}/analyst-pass-2`, pythonResult),
              final,
            ];
          if (worker === "root/team/lead-1/agent-2") return [receipt(worker, pythonResult)];
          if (worker === "root/team/lead-2/agent-1")
            return [receipt(worker, { conclusion: "An unfinished response." }, "requesting")];
          if (worker === "root/team/lead-3/agent-1")
            return [
              receipt(worker, { conclusion: "An unfinished check.", next_lead: "Continue." }),
            ];
          return [
            receipt(worker, {
              conclusion: "The synthetic release was compared with its recorded benchmark.",
              ...(worker === "root/team/lead-2/agent-20" ? { review_question: secondary } : {}),
            }),
          ];
        }),
      ];
    }),
  ];
  const artifactReads: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/artifacts/"))
      artifactReads.push(request.url());
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const { panel, review, checkpoint, submitted } = await openJudgment(page, attempts, {
    lead_count: 4,
    researchers_per_lead: 20,
  });
  const draft = panel.getByLabel("Direction for the editor");
  const feedback = "Retain the original weights. Qualify the vintage comparison in the report.";
  await draft.fill(feedback);
  const disclosure = panel.getByText("Research behind this review (77)", { exact: true });
  const list = panel.getByRole("list", { name: "Saved research findings" });
  await expect(disclosure).toBeVisible();
  await expect(panel.locator("li")).toHaveCount(0);
  await disclosure.press("Enter");
  const links = list.getByRole("link");
  await expect(links).toHaveCount(8);
  await expect(list.getByText("Raised this question", { exact: true })).toHaveCount(2);
  await expect(links.nth(0)).toHaveText("Weekly release 20 · Pass 1 · Lead 2");
  await expect(links.nth(1)).toHaveText("Weekly release 20 · Pass 3 · Lead 4");
  await panel.getByRole("button", { name: "Show 8 more findings" }).click();
  await expect(links).toHaveCount(16);
  await expect(links.nth(8)).toBeFocused();

  const search = panel.getByRole("searchbox", { name: "Find a research assignment" });
  await search.fill("Lead 3 Weekly release 01");
  await expect(panel.getByRole("status")).toHaveText("No matching findings.");
  await search.fill("Lead 4 Weekly release 20");
  await expect(links).toHaveCount(1);
  await links.first().press("Enter");

  const workspace = page.getByRole("region", { name: "Weekly release 20 workspace" });
  await expect(workspace).toBeFocused();
  await expect(workspace).toContainText(final.result!.conclusion);
  expect(new URL(page.url()).searchParams.get("pass")).toBe(final.id);
  await expect(workspace.getByRole("heading", { name: "Pass 3", exact: true })).toBeVisible();
  await workspace.getByRole("link", { name: "Return to your judgment" }).press("Enter");
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue(feedback);
  await expect(search).toHaveValue("Lead 4 Weekly release 20");
  expect(new URL(page.url()).hash).toBe("#editor-feedback");
  expect(artifactReads).toEqual([]);
  expect(submitted).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await panel.getByRole("button", { name: "Continue to report" }).click();
  await expect
    .poll(() => submitted)
    .toEqual([
      {
        checkpoint_id: checkpoint,
        interrupt_id: review.interrupt_id,
        decision: "approve",
        feedback,
      },
    ]);
  await expect(workspace.getByRole("link", { name: "Return to your judgment" })).toHaveCount(0);
});

test("omit the editorial handoff when a small team only recorded unfinished work", async ({
  page,
}) => {
  const { panel } = await openJudgment(page, [
    receipt("root/team/plan", {
      team_plan: { assignments: [{ title: "Releases", objective: "Check the weights." }] },
    }),
    receipt("root/team/agent-1", pythonResult),
    receipt(
      "root/team/agent-1/analyst-pass-2",
      { conclusion: "An unfinished response." },
      "requesting",
    ),
  ]);
  await expect(panel.getByLabel("Direction for the editor")).toBeVisible();
  await expect(panel.getByText(/Research behind this review/)).toHaveCount(0);
});
