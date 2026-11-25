import type { RunSnapshot } from "../src/lib/workflow";
import { expect, test } from "./fixtures";

type Attempt = NonNullable<RunSnapshot["model_attempts"]>[number];
type Result = NonNullable<Attempt["result"]>;

function receipt(path: string, seconds: number, result: Partial<Result>): Attempt {
  const stamp = new Date(Date.UTC(2026, 10, 24, 13, 0, seconds)).toISOString();
  return {
    id: crypto.randomUUID(),
    path,
    model: "synthetic",
    status: "completed",
    stage: "custom",
    input_bytes: 0,
    output_characters: 0,
    created_at: stamp,
    finished_at: stamp,
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

test("find a file version across study assignments and open its original pass", async ({
  page,
}) => {
  const runId = crypto.randomUUID();
  const director = receipt("root/team/plan", 1, {
    swarm_plan: {
      leads: [
        { title: "Rates lead", objective: "Inspect revisions." },
        { title: "Credit lead", objective: "Inspect funding." },
      ],
    },
  });
  const rates = receipt("root/team/lead-1/turn-1", 2, {
    swarm_action: {
      action: "delegate",
      rationale: "Find revised observations.",
      assignments: [{ title: "Release checks", objective: "Compare the reported vintages." }],
    },
  });
  const credit = receipt("root/team/lead-2/turn-1", 3, {
    swarm_action: {
      action: "delegate",
      rationale: "Find funding observations.",
      assignments: [{ title: "Funding checks", objective: "Trace the funding series." }],
    },
  });
  const files = new Map<string, string>();
  function observations(digit: string, label: string) {
    const id = `sha256:${digit.repeat(64)}`;
    const body = `Vintage,Value\n${label},${digit}\n`;
    files.set(id, body);
    return {
      name: "observations.csv",
      artifact_id: id,
      media_type: "text/csv",
      byte_size: body.length,
    };
  }
  const original = observations("1", "Original");
  const revised = observations("2", "Revised");
  const independent = observations("3", "Independent");
  const earlier = receipt("root/team/lead-1/agent-1", 4, {
    workspace_activity: {
      tool: "run_python",
      status: "completed",
      summary: "Saved the original observations.",
      output: "",
      files: [original],
    },
  });
  const later = receipt("root/team/lead-1/agent-1/analyst-pass-2", 5, {
    workspace_files: [revised],
  });
  const carried = receipt("root/team/lead-1/agent-1/analyst-pass-3", 6, {
    workspace_files: [revised],
  });
  const second = receipt("root/team/lead-2/agent-1", 7, {
    workspace_files: [independent],
  });
  const contentReads: string[] = [];
  await page.route("**/api/artifacts/*/content*", (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[3]!);
    contentReads.push(id);
    return route.fulfill({ body: files.get(id) ?? "", contentType: "text/csv" });
  });
  await page.route(`**/api/runs/${runId}`, (route) =>
    route.fulfill({
      json: {
        id: runId,
        brief: "Reopen an exact saved study file.",
        status: "completed",
        execution_pending: false,
        created_at: director.created_at,
        events: [],
        artifacts: [],
        workflow: {
          nodes: [{ id: "team", config: { type: "research", team: { swarm: { lead_count: 2 } } } }],
        },
        research_manifest: {
          settings: { model: "synthetic", limits: { max_model_calls: 30 } },
          evidence: [],
          tool_config: { session: "brief-led-1" },
        },
        model_attempts: [director, rates, credit, earlier, later, carried, second],
      },
    }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?session=${runId}&workspace=director`);
  await page
    .getByRole("navigation", { name: "Study sections" })
    .getByRole("link", { name: "Saved files", exact: true })
    .click();
  await page.getByRole("button", { name: "Recent versions", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Find a saved file", exact: true });
  const rows = page.getByRole("list", { name: "Saved file results" }).getByRole("listitem");
  await expect(rows).toHaveCount(3);
  await search.fill("observations.csv rates lead");
  await expect(rows).toHaveCount(2);
  await search.fill("Funding checks");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Credit lead");
  await search.fill(later.path);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Pass 2");
  expect(contentReads).toEqual([]);

  await search.fill("release checks");
  const firstVersion = rows.filter({ hasText: "Pass 1" });
  await firstVersion.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(firstVersion.getByRole("cell", { name: "Original", exact: true })).toBeVisible();
  expect(new Set(contentReads)).toEqual(new Set([original.artifact_id]));
  await expect(firstVersion.getByRole("link", { name: "Download" })).toHaveAttribute(
    "href",
    `/api/artifacts/${encodeURIComponent(original.artifact_id)}/content?filename=observations.csv`,
  );
  const producingPass = firstVersion.getByRole("link", { name: "Open saved pass" });
  await producingPass.click();
  const workspace = page.getByRole("region", { name: "Release checks workspace" });
  await expect(workspace).toBeFocused();
  await expect(workspace.getByRole("region", { name: "Pass 1", exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("pass")).toBe(earlier.id);
  const backToFiles = workspace.getByRole("link", { name: "Back to saved files" });
  await backToFiles.click();
  await expect(producingPass).toBeFocused();
  await page.locator("#study-files-heading").click();
  await expect(producingPass).toHaveCount(0);
  await backToFiles.click();
  await expect(producingPass).toBeFocused();
  await expect(search).toHaveValue("release checks");
  await expect(firstVersion.getByRole("cell", { name: "Original", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("keeps an exact Saved files row and preview as new live files arrive", async ({ page }) => {
  const runId = crypto.randomUUID();
  const leadPath = "root/team/lead-1";
  const plan = receipt("root/team/plan", 0, {
    swarm_plan: {
      leads: [
        { title: "Rates lead", objective: "Compare releases." },
        { title: "Credit lead", objective: "Check the timing." },
      ],
    },
  });
  const lead = receipt(`${leadPath}/turn-1`, 1, {
    swarm_action: {
      action: "delegate",
      rationale: "Read separate revisions.",
      assignments: Array.from({ length: 4 }, (_, index) => ({
        title: `Release series ${index + 1}`,
        objective: "Record the corrected observations.",
      })),
    },
  });
  const latest = Array.from({ length: 24 }, (_, index) => {
    const number = index + 1;
    const worker = Math.floor(index / 6) + 1;
    const pass = (index % 6) + 1;
    const workspace = `${leadPath}/agent-${worker}`;
    const path = pass === 1 ? workspace : `${workspace}/analyst-pass-${pass}`;
    const artifactId = `sha256:${number.toString(16).padStart(64, "0")}`;
    const body = `Vintage,Value\nObservation ${number},${number}\n`;
    return {
      artifactId,
      body,
      attempt: receipt(path, number + 1, {
        workspace_files: [
          {
            name: "observations.csv",
            artifact_id: artifactId,
            media_type: "text/csv",
            byte_size: body.length,
          },
        ],
      }),
    };
  });
  await page.route("**/api/artifacts/*/content*", (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[3]!);
    const file = latest.find(({ artifactId }) => artifactId === id);
    return file
      ? route.fulfill({ body: file.body, contentType: "text/csv" })
      : route.fulfill({ status: 404 });
  });
  const target = latest[2]!;
  let count = 21;
  let hideFile = false;
  await page.route(`**/api/runs/${runId}`, (route) =>
    route.fulfill({
      json: {
        id: runId,
        brief: "Review exact files through live study updates.",
        status: "running",
        execution_pending: false,
        created_at: plan.created_at,
        events: [],
        artifacts: [],
        evidence_ids: [],
        workflow: {
          nodes: [{ id: "team", config: { type: "research", team: { swarm: { lead_count: 2 } } } }],
        },
        research_manifest: {
          settings: { model: "synthetic", limits: { max_model_calls: 60 } },
          evidence: [],
          tool_config: { session: "brief-led-1" },
        },
        model_attempts: [
          plan,
          lead,
          ...latest
            .slice(0, count)
            .map(({ attempt }) =>
              hideFile && attempt.id === target.attempt.id
                ? { ...attempt, result: { ...attempt.result, workspace_files: [] } }
                : attempt,
            ),
        ],
      },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?session=${runId}&workspace=director`);
  await page.getByRole("link", { name: "Saved files", exact: true }).click();
  await page.getByRole("button", { name: "Recent versions", exact: true }).click();
  const index = page.locator("#study-files");
  const search = index.getByRole("searchbox", { name: "Find a saved file", exact: true });
  await search.fill("observations.csv rates lead");
  const rows = index.getByRole("list", { name: "Saved file results" }).getByRole("listitem");
  const previewName = "observations.csv · Rates lead · Release series 1 · Pass 2";
  const previewRow = index.getByRole("listitem", { name: previewName, exact: true });
  const vintage = previewRow.getByRole("cell", { name: "Observation 2", exact: true });
  const countStatus = index.getByRole("status").filter({ hasText: /saved files/ });
  await expect(rows).toHaveCount(20);
  await expect(rows.last()).toHaveAccessibleName(previewName);
  await previewRow.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(vintage).toBeVisible();

  count += 1;
  await expect(countStatus).toHaveText("22 saved files");
  await expect(rows).toHaveCount(21);
  await expect(vintage).toBeVisible();
  await expect(
    previewRow.getByRole("button", { name: "Close preview", exact: true }),
  ).toBeFocused();

  const query = "observations.csv rates lead release";
  await search.fill(query);
  await expect(rows).toHaveCount(20);
  await expect(previewRow).toHaveCount(0);
  const fileName = "observations.csv · Rates lead · Release series 1 · Pass 3";
  const row = index.getByRole("listitem", { name: fileName, exact: true });
  const passLink = row.getByRole("link", { name: "Open saved pass", exact: true });
  await expect(rows.last()).toHaveAccessibleName(fileName);
  await passLink.click();
  const workspace = page.getByRole("region", { name: "Release series 1 workspace" });
  await expect(workspace).toBeFocused();
  expect(new URL(page.url()).searchParams.get("pass")).toBe(target.attempt.id);
  await index.locator("#study-files-heading").click();
  await expect(row).toHaveCount(0);

  count += 1;
  await expect(page.getByText("25 recorded passes", { exact: true })).toBeVisible();
  const back = workspace.getByRole("link", { name: "Back to saved files", exact: true });
  await back.click();
  await expect(passLink).toBeFocused();
  await expect(countStatus).toHaveText("23 saved files");
  await expect(rows).toHaveCount(21);
  await expect(search).toHaveValue(query);
  await expect(row.getByRole("link", { name: "Download", exact: true })).toHaveAttribute(
    "href",
    `/api/artifacts/${encodeURIComponent(target.artifactId)}/content?filename=observations.csv`,
  );

  await index.getByRole("button", { name: "Show more files", exact: true }).click();
  await expect(rows).toHaveCount(23);
  count += 1;
  await expect(rows).toHaveCount(24);

  hideFile = true;
  await expect(row).toHaveCount(0);
  await back.click();
  await expect(index.locator("#study-files-heading")).toBeFocused();
  await expect(search).toHaveValue(query);
});
