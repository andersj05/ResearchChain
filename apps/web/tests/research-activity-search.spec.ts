import type { RunSnapshot } from "../src/lib/workflow";
import { expect, test } from "./fixtures";

type Attempt = NonNullable<RunSnapshot["model_attempts"]>[number];
type Result = NonNullable<Attempt["result"]>;

test("searches beyond the visible activity and keeps its place when new passes arrive", async ({
  page,
}) => {
  const runId = crypto.randomUUID();
  const start = Date.UTC(2026, 10, 20, 12);
  function receipt(path: string, offset: number, result: Partial<Result>): Attempt {
    const time = new Date(start + offset * 60_000).toISOString();
    return {
      id: crypto.randomUUID(),
      path,
      stage: "custom",
      model: "synthetic",
      status: "completed",
      created_at: time,
      finished_at: time,
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
  const plan = receipt("root/team/plan", 0, {
    swarm_plan: {
      leads: [
        { title: "Credit spreads", objective: "Review the historical credit vintages." },
        { title: "Macro prices", objective: "Review the latest release." },
      ],
    },
  });
  const credit = receipt("root/team/lead-1/turn-1", 1, {
    swarm_action: {
      action: "delegate",
      rationale: "Read the credit releases.",
      assignments: [{ title: "Curve checks", objective: "Compare credit reports." }],
    },
  });
  const macro = receipt("root/team/lead-2/turn-1", 2, {
    swarm_action: {
      action: "delegate",
      rationale: "Read each macro series.",
      assignments: Array.from({ length: 3 }, (_, index) => ({
        title: `Series ${index + 1}`,
        objective: "Compare recent observations.",
      })),
    },
  });
  const creditFiles = ["Original", "Revised"].map((vintage) => ({
    name: "observations.csv",
    artifact_id: crypto.randomUUID(),
    media_type: "text/csv",
    body: `Vintage,Value\n${vintage},1\n`,
  }));
  await Promise.all(
    creditFiles.map(({ artifact_id, body }) =>
      page.route(`**/api/artifacts/${artifact_id}/content`, (route) =>
        route.fulfill({ contentType: "text/csv", body }),
      ),
    ),
  );
  const [original, revised] = creditFiles.map(({ body, ...file }, index) =>
    receipt(
      index ? "root/team/lead-1/agent-1/analyst-pass-2" : "root/team/lead-1/agent-1",
      3 + index,
      {
        conclusion: index
          ? "The revised release moved the estimate."
          : "Background information. ".repeat(16) + "The archival-vintage gap widened.",
        workspace_files: [{ ...file, byte_size: body.length }],
      },
    ),
  );
  const recent = Array.from({ length: 24 }, (_, index) => {
    const worker = Math.floor(index / 8) + 1;
    const pass = (index % 8) + 1;
    const path = `root/team/lead-2/agent-${worker}${pass > 1 ? `/analyst-pass-${pass}` : ""}`;
    return receipt(path, index + 5, { conclusion: `Macro observation ${index + 1}.` });
  });
  const added = receipt("root/team/lead-2/agent-3/analyst-pass-9", 29, {
    conclusion: "The latest poll added a receipt.",
  });
  let publishReceipt = false;
  await page.route(`**/api/runs/${runId}`, (route) =>
    route.fulfill({
      json: {
        id: runId,
        brief: "Review synthetic releases from several teams.",
        created_at: plan.created_at,
        status: "running",
        execution_pending: false,
        events: [],
        artifacts: [],
        evidence_ids: [],
        workflow: {
          nodes: [
            {
              id: "team",
              config: { type: "research", team: { swarm: { lead_count: 2 } } },
            },
          ],
        },
        research_manifest: {
          settings: { model: "synthetic", limits: { max_model_calls: 100 } },
          evidence: [],
          tool_config: { session: "brief-led-1" },
        },
        model_attempts: [
          plan,
          credit,
          macro,
          original,
          revised,
          ...recent,
          ...(publishReceipt ? [added] : []),
        ],
      },
    }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?session=${runId}`);
  const activityShortcut = page.getByRole("link", { name: "Activity log", exact: true });
  await activityShortcut.click();
  const log = page.locator("#research-activity");
  const search = log.getByRole("searchbox", { name: "Search study activity" });
  const results = log.getByRole("list", { name: "Recorded model passes" }).getByRole("button");
  await expect(results).toHaveCount(12);
  await expect(results.first()).toContainText("Series 3 · Pass 8");
  await log.getByRole("button", { name: "Show earlier passes" }).click();
  await expect(results).toHaveCount(24);
  await expect(results.nth(12)).toBeFocused();
  const oldestShown = await results.last().getAttribute("id");
  publishReceipt = true;
  await expect(results.first()).toContainText("Series 3 · Pass 9");
  await expect(results).toHaveCount(25);
  await expect(results.last()).toHaveAttribute("id", oldestShown!);
  await expect(results.filter({ hasText: "Curve checks" })).toHaveCount(0);

  const query = "CREDIT curve pass 1 archival-vintage observations.csv root/team/lead-1/agent-1";
  await search.fill(query);
  await expect(log.getByRole("status")).toHaveText("1 matching pass");
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText("The archival-vintage gap widened.");
  await expect(results.first()).toContainText("observations.csv");
  await search.press("Enter");
  const workspace = page.getByRole("region", { name: "Curve checks workspace" });
  await expect(workspace).toBeFocused();
  await expect(workspace.getByRole("region", { name: "Pass 1", exact: true })).toContainText(
    "The archival-vintage gap widened.",
  );
  expect(new URL(page.url()).searchParams.get("pass")).toBe(original!.id);
  const backToActivity = workspace.getByRole("link", { name: "Back to activity" });
  await backToActivity.click();
  await expect(results.first()).toBeFocused();
  await expect(search).toHaveValue(query);
  await expect(results).toHaveCount(1);
  await search.fill("no matching receipt");
  await expect(log.getByRole("status")).toHaveText("No passes match this search.");
  await backToActivity.click();
  await expect(log.locator("summary")).toBeFocused();
  await expect(search).toHaveValue("no matching receipt");
  await search.press("Escape");
  await expect(search).toBeEmpty();
  await expect(results).toHaveCount(12);
  await expect(results.first()).toContainText("Series 3 · Pass 9");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
