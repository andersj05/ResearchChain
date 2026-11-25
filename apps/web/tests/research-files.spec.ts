import type { RunSnapshot } from "../src/lib/workflow";
import { expect, test } from "./fixtures";

type Attempt = NonNullable<RunSnapshot["model_attempts"]>[number];
type Result = NonNullable<Attempt["result"]>;

test("find a file version across study assignments and open its original pass", async ({
  page,
}) => {
  const runId = crypto.randomUUID();
  function receipt(path: string, second: number, result: Partial<Result>): Attempt {
    const time = new Date(Date.UTC(2026, 10, 24, 13, 0, second)).toISOString();
    return {
      id: crypto.randomUUID(),
      path,
      model: "synthetic",
      status: "completed",
      stage: "custom",
      input_bytes: 0,
      output_characters: 0,
      created_at: time,
      finished_at: time,
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
  await firstVersion.getByRole("link", { name: "Open saved pass" }).click();
  const workspace = page.getByRole("region", { name: "Release checks workspace" });
  await expect(workspace).toBeFocused();
  await expect(workspace.getByRole("region", { name: "Pass 1", exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("pass")).toBe(earlier.id);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
