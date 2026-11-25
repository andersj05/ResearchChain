import type { RunSnapshot } from "../src/lib/workflow";
import { expect, test } from "./fixtures";

type Attempt = NonNullable<RunSnapshot["model_attempts"]>[number];
type Result = NonNullable<Attempt["result"]>;

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

test("searches beyond the visible activity and keeps its place when new passes arrive", async ({
  page,
}) => {
  const runId = crypto.randomUUID();
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

test("finds an older pass in a large swarm and returns to it after a live result arrives", async ({
  page,
}) => {
  const runId = crypto.randomUUID();
  const researchersPerLead = 20;
  const passesPerResearcher = 6;
  const leads = Array.from({ length: 4 }, (_, index) => ({
    title: `Lead ${index + 1}`,
    objective: "Check the recorded release history.",
  }));
  const plan = receipt("root/team/plan", 0, { swarm_plan: { leads } });
  const turns = leads.map((_, leadIndex) =>
    receipt(`root/team/lead-${leadIndex + 1}/turn-1`, leadIndex + 1, {
      swarm_action: {
        action: "delegate",
        rationale: "Inspect the saved series.",
        assignments: Array.from({ length: researchersPerLead }, (_, researcherIndex) => ({
          title: `Assignment ${leadIndex + 1}.${researcherIndex + 1}`,
          objective: "Compare reported values with archived observations.",
        })),
      },
    }),
  );
  const oldPath = "root/team/lead-1/agent-1/analyst-pass-2";
  const incomingPath = "root/team/lead-4/agent-20/analyst-pass-2";
  const note =
    "Background research describes ordinary prior observations and market context. ".repeat(52);
  const csv = "Vintage,Value\nOriginal,7\n";
  const file = {
    name: "curve-vintage.csv",
    artifact_id: crypto.randomUUID(),
    media_type: "text/csv",
    byte_size: csv.length,
  };
  await page.route(`**/api/artifacts/${file.artifact_id}/content`, (route) =>
    route.fulfill({ contentType: "text/csv", body: csv }),
  );

  const history = leads.flatMap((_, leadIndex) =>
    Array.from({ length: researchersPerLead }, (_, researcherIndex) => {
      const position = leadIndex * researchersPerLead + researcherIndex;
      const path = `root/team/lead-${leadIndex + 1}/agent-${researcherIndex + 1}`;
      // The last assignment has a second pass arriving while the study is open.
      const lastResearcher = position === leads.length * researchersPerLead - 1;
      return Array.from({ length: lastResearcher ? 1 : passesPerResearcher }, (_, passIndex) => {
        const step = passIndex ? `${path}/analyst-pass-${passIndex + 1}` : path;
        return receipt(step, 6 + position * passesPerResearcher + passIndex, {
          conclusion:
            step === oldPath
              ? `${note} Crédit archival-gap finding retained in the older receipt.`
              : `${note} Recorded observation for ${position + 1}.`,
          ...(step === oldPath && { workspace_files: [file] }),
        });
      });
    }).flat(),
  );
  const old = history.find(({ path }) => path === oldPath)!;
  const newerCsv = "Vintage,Value\nUpdated,9\n";
  const newerFile = { ...file, artifact_id: crypto.randomUUID(), byte_size: newerCsv.length };
  await page.route(`**/api/artifacts/${newerFile.artifact_id}/content`, (route) =>
    route.fulfill({ contentType: "text/csv", body: newerCsv }),
  );
  const incoming = receipt(incomingPath, 500, {
    conclusion: `${note} Crédit archival-gap finding in the new receipt.`,
    workspace_files: [newerFile],
  });
  let publish = false;
  await page.route(`**/api/runs/${runId}`, (route) =>
    route.fulfill({
      json: {
        id: runId,
        brief: "Inspect a large synthetic swarm.",
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
              config: { type: "research", team: { swarm: { lead_count: 4 } } },
            },
          ],
        },
        research_manifest: {
          settings: { model: "synthetic", limits: { max_model_calls: 500 } },
          evidence: [],
          tool_config: { session: "brief-led-1" },
        },
        model_attempts: [plan, ...turns, ...history, ...(publish ? [incoming] : [])],
      },
    }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?session=${runId}`);
  const log = page.locator("#research-activity");
  await expect(log.locator("summary")).toHaveText("Activity log · 480 recorded passes");
  await expect(log.locator("input")).toHaveCount(0);
  await page.getByRole("link", { name: "Activity log", exact: true }).click();
  const search = log.getByRole("searchbox", { name: "Search study activity" });
  const status = log.getByRole("status");
  const results = log.getByRole("list", { name: "Recorded model passes" }).getByRole("button");
  await expect(log.locator("summary")).toHaveText("Activity log · 480 recorded passes");
  await expect(results).toHaveCount(12);
  await expect(results.filter({ hasText: "Assignment 1.1 · Pass 2" })).toHaveCount(0);

  const query = "CRÉDIT pass #2 archival-gap curve-vintage.csv";
  await search.fill(query);
  await expect(status).toHaveText("1 matching pass");
  await expect(results.first()).toContainText("Crédit archival-gap finding retained");
  await search.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await search.dispatchEvent("keydown", { key: "Escape", isComposing: true });
  await expect(search).toBeFocused();
  await expect(search).toHaveValue(query);
  expect(new URL(page.url()).searchParams.get("pass")).toBeNull();

  await search.press("Enter");
  const workspace = page.getByRole("region", { name: "Assignment 1.1 workspace" });
  await expect(workspace).toBeFocused();
  await expect(workspace.getByRole("region", { name: "Pass 2", exact: true })).toContainText(
    "Crédit archival-gap finding retained",
  );
  await expect(workspace.getByRole("cell", { name: "Original", exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("pass")).toBe(old.id);

  publish = true;
  await expect(status).toHaveText("2 matching passes");
  await expect(workspace).toBeFocused();
  await expect(workspace.getByRole("cell", { name: "Original", exact: true })).toBeVisible();
  await log.locator("summary").click();
  await expect(log.locator("input")).toHaveCount(0);
  await expect(log.locator("summary")).toHaveText("Activity log · 481 recorded passes");
  await workspace.getByRole("link", { name: "Back to activity", exact: true }).click();
  await expect(search).toHaveValue(query);
  await expect(results.first()).toContainText("Assignment 4.20 · Pass 2");
  await expect(results.last()).toContainText("Assignment 1.1 · Pass 2");
  await expect(results.last()).toBeFocused();
  expect(new URL(page.url()).searchParams.get("pass")).toBe(old.id);

  await search.press("Escape");
  await expect(search).toBeEmpty();
  await expect(results).toHaveCount(12);
  await search.fill("pass #2");
  await expect(status).toHaveText("Showing 12 of 80 matching passes");
  await expect(results.first()).toContainText("Assignment 4.20 · Pass 2");
});
