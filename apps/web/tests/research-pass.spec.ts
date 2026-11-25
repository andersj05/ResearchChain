import type { RunSnapshot } from "../src/lib/workflow";
import { expect, test } from "./fixtures";

type Attempt = NonNullable<RunSnapshot["model_attempts"]>[number];
type Result = NonNullable<Attempt["result"]>;

test("reopens an exact historical pass with its own findings, files, and sources", async ({
  page,
}) => {
  const runId = crypto.randomUUID();
  function receipt(path: string, day: number, result: Partial<Result>): Attempt {
    const time = new Date(Date.UTC(2026, 10, day)).toISOString();
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
  const plan = receipt("root/team/plan", 19, {
    team_plan: {
      assignments: [{ title: "Release checks", objective: "Compare the data vintages." }],
    },
  });
  const attempts = [plan];
  for (const [index, vintage] of ["Original", "Revised"].entries()) {
    const artifactId = crypto.randomUUID();
    const csv = `Vintage,Value\n${vintage},${index + 1}\n`;
    const source = `https://example.test/${vintage.toLowerCase()}-release`;
    const attempt = receipt(
      index ? "root/team/agent-1/analyst-pass-2" : "root/team/agent-1",
      20 + index,
      {
        conclusion: `${vintage} conclusion. [${vintage} release](${source})`,
        workspace_files: [
          {
            name: "observations.csv",
            media_type: "text/csv",
            artifact_id: artifactId,
            byte_size: csv.length,
          },
        ],
        web_research: {
          version: "web-research-1",
          observed_at: plan.created_at,
          truncated: false,
          actions: [],
          sources: [{ title: `${vintage} release`, url: source, cited: true }],
        },
      },
    );
    attempt.input_artifact_id = crypto.randomUUID();
    attempts.push(attempt);
    await page.route(`**/api/artifacts/${artifactId}/content`, (route) =>
      route.fulfill({ body: csv, contentType: "text/csv" }),
    );
  }
  const [, earlier, later] = attempts;
  await page.route(`**/api/runs/${runId}`, (route) =>
    route.fulfill({
      json: {
        id: runId,
        brief: "Audit the original and revised observations.",
        created_at: plan.created_at,
        status: "completed",
        execution_pending: false,
        events: [],
        artifacts: [],
        evidence_ids: [],
        workflow: { nodes: [] },
        research_manifest: {
          settings: { model: "synthetic", limits: { max_model_calls: 30 } },
          evidence: [],
          tool_config: { session: "brief-led-1" },
        },
        model_attempts: attempts,
      },
    }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?session=${runId}&workspace=agent-1`);
  const workspace = page.getByRole("region", { name: "Release checks workspace" });
  await expect(workspace).toContainText("Revised conclusion.");
  await expect(workspace.getByRole("cell", { name: "Revised" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Study sections" })
    .getByRole("link", { name: "Activity log" })
    .click();
  await page
    .locator("#research-activity")
    .getByRole("button", { name: /Release checks.*Pass 1/ })
    .click();
  const savedPass = workspace.getByRole("region", { name: "Pass 1", exact: true });
  await expect(workspace).toBeFocused();
  await expect(savedPass).toContainText("Original conclusion.");
  await expect(workspace).not.toContainText("Revised conclusion.");
  const files = savedPass.getByRole("region", { name: "Files in this pass" });
  await expect(files.getByRole("cell", { name: "Original" })).toBeVisible();
  await expect(files.getByRole("cell", { name: "Revised" })).toHaveCount(0);
  await expect(savedPass.getByRole("link", { name: "Original release" })).toBeVisible();
  await expect(savedPass.getByRole("link", { name: "Revised release" })).toHaveCount(0);
  await expect(savedPass.getByRole("link", { name: "Saved request" })).toHaveAttribute(
    "href",
    new RegExp(earlier!.input_artifact_id!),
  );
  await expect(savedPass.getByRole("link", { name: "Inspect pass in Runs" })).toHaveAttribute(
    "href",
    `/?view=runs&run=${runId}&attempt=${earlier!.id}`,
  );

  const bookmark = page.url();
  expect(new URL(bookmark).searchParams.get("pass")).toBe(earlier!.id);
  await page.reload();
  await expect(page).toHaveURL(bookmark);
  await expect(savedPass).toContainText("Original conclusion.");
  await expect(files.getByRole("cell", { name: "Original" })).toBeVisible();
  await expect(workspace).not.toContainText("Revised conclusion.");
  await savedPass.getByLabel("Inspect model pass").selectOption(later!.id);
  await expect(workspace.getByRole("region", { name: "Pass 2", exact: true })).toContainText(
    "Revised conclusion.",
  );
  await workspace.getByRole("button", { name: "Back to latest workspace" }).click();
  await expect(workspace).toBeFocused();
  await expect(workspace.getByRole("cell", { name: "Revised" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("pass")).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
