import { createHash } from "node:crypto";
import { expect, test } from "./fixtures";
import {
  discretionaryMacroWorkflow,
  type RunSnapshot,
  type Workflow,
  type WorkflowRevision,
} from "../src/lib/workflow";
import { compareWorkflowGraphs } from "../src/lib/workflow-comparison";
import nested from "../../../examples/advanced-workflow.json";

test("workflow deltas follow pinned subgraph versions and ignore presentation changes", () => {
  const before = nested as Workflow;
  const after = structuredClone(before);
  after.edges.reverse();
  after.nodes[0]!.position.x += 80;
  expect(compareWorkflowGraphs(before, after)).toEqual([]);

  const loop = after.nodes.find((node) => node.config?.type === "loop");
  if (loop?.config?.type !== "loop") throw new Error("Expected the review loop fixture.");
  loop.config.ref.version = 2;
  const replacement = structuredClone(after.subgraphs![0]!);
  replacement.version = 2;
  replacement.nodes[0]!.instructions = "Which observation would invalidate the new thesis?";
  after.subgraphs!.push(replacement);

  const graphs = compareWorkflowGraphs(before, after);
  expect(graphs.map((graph) => graph.key)).toEqual(["root", "critique@1/critique@2"]);
  expect(graphs[1]!.steps).toEqual([
    {
      id: "review",
      label: "Review",
      status: "Changed",
      settings: [
        {
          name: "Review question",
          before: "Is this reasoning ready for the next pass?",
          after: "Which observation would invalidate the new thesis?",
        },
      ],
    },
  ]);
});

test("compare two saved research runs without switching the open run", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const bodies = new Map<string, string>();
  const csv = (name: string, body: string) => {
    const artifact_id = `sha256:${createHash("sha256").update(body).digest("hex")}`;
    bodies.set(artifact_id, body);
    return { name, artifact_id, byte_size: Buffer.byteLength(body), media_type: "text/csv" };
  };
  const oldTable = csv("pricing.csv", 'horizon,change,note\r\n5,0.000,"basis, ""roll"""\r\n');
  const extraHeaders = Array.from({ length: 18 }, (_, index) => `measure_${index + 1}`);
  const extraValues = ",0".repeat(extraHeaders.length);
  const newTable = csv(
    "pricing.csv",
    `horizon,change,note,${extraHeaders.join(",")}\r\n` +
      `20,018.000,"first line\r\nsecond line"${extraValues}\r\n` +
      Array.from(
        { length: 50 },
        (_, index) => `${index + 21},1.00,observed${extraValues}\r\n`,
      ).join(""),
  );
  const stable = csv("controls.csv", "control,base\npolicy,1");
  const intermediate = csv("controls.csv", "control,base\npolicy,2");
  const oldOnly = csv("old-test.csv", "sample,estimate\nrest,5,ragged");
  const now = new Date().toISOString();
  const priorSource = crypto.randomUUID();
  const newSource = crypto.randomUUID();
  const sharedSources = [crypto.randomUUID(), crypto.randomUUID()];
  const base: RunSnapshot = {
    id: crypto.randomUUID(),
    workflow: discretionaryMacroWorkflow,
    workflow_name: discretionaryMacroWorkflow.name,
    revision_id: crypto.randomUUID(),
    revision_number: 12,
    status: "completed",
    execution_pending: false,
    compiler_version: "research-0.3.0",
    checkpoint_id: null,
    created_at: now,
    brief: "Five sessions around the synthetic central bank event.",
    artifacts: [],
    evidence_ids: [...sharedSources, priorSource],
    events: [],
    model_attempts: [
      {
        id: crypto.randomUUID(),
        created_at: now,
        path: "root/memo",
        stage: "custom",
        status: "completed",
        model: "analysis-model",
        returned_model: "analysis-model-snapshot",
        input_bytes: 100,
        output_characters: 100,
        result: {
          schema_version: "research-result-1",
          stage: "custom",
          conclusion: "**The rival mechanism survived.**",
          hypotheses: [],
          limitations: [],
          revision_summary: "First comparison.",
          evidence_requests: [],
          unresolved_questions: [],
          workspace_files: [oldTable, stable, oldOnly],
        },
      },
    ],
  };
  const adjusted = structuredClone(base.workflow);
  const first = adjusted.nodes.find((node) => node.id === "map")!;
  first.instructions = "Compare front-end and belly pricing over twenty sessions.";
  if (first.config?.type !== "research") throw new Error("Expected the macro research fixture.");
  first.config.model = "analysis-model";
  first.config.web_search = false;
  adjusted.research!.limits!.max_total_tokens = 65000;
  const original = base.model_attempts![0]!;
  const outputAttempt = (files: (typeof oldTable)[], path: string) => ({
    ...original,
    id: crypto.randomUUID(),
    path,
    result: {
      ...original.result!,
      workspace_files: files,
      workspace_activity: {
        tool: "run_python",
        status: "completed",
        summary: "Saved tables",
        output: "",
      } as const,
    },
  });
  const current: RunSnapshot = {
    ...base,
    id: crypto.randomUUID(),
    revision_id: crypto.randomUUID(),
    revision_number: 13,
    workflow: adjusted,
    brief: "Check whether it survives a month-long window.",
    evidence_ids: [...sharedSources.toReversed(), newSource],
    events: [
      {
        node_id: "judgment",
        kind: "review",
        label: "Weigh the thesis and the dissent",
        detail: "Approved by reviewer",
        review_response: { decision: "approve", feedback: "Check the curve against the dollar." },
      },
    ],
    model_attempts: [
      outputAttempt([newTable, intermediate], "root/memo"),
      outputAttempt([newTable, stable], "root/memo/analyst-pass-2"),
    ],
  };
  const otherAgent = { ...base, id: crypto.randomUUID(), agent_id: crypto.randomUUID() };
  const matchingOutputs = { ...current, id: crypto.randomUUID() };
  await page.route("**/api/runs", (route) =>
    route.fulfill({ json: [current, base, otherAgent, matchingOutputs] }),
  );
  await page.route("**/api/evidence/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    return route.fulfill({ json: { id, title: `Synthetic source ${id?.slice(0, 8)}` } });
  });
  for (const run of [current, base, matchingOutputs]) {
    await page.route(`**/api/runs/${run.id}`, (route) => route.fulfill({ json: run }));
  }
  for (const [id, body] of bodies) {
    await page.route(`**/api/artifacts/${encodeURIComponent(id)}/content*`, (route) =>
      route.fulfill({ body, contentType: "text/csv" }),
    );
  }
  const revision: WorkflowRevision = {
    id: current.revision_id,
    number: current.revision_number,
    content_hash: "0123456789abcdef",
    created_at: now,
    name: current.workflow_name,
    workflow: current.workflow,
  };
  await page.route(`**/api/revisions/${revision.id}`, (route) => route.fulfill({ json: revision }));
  await page.goto(`/?run=${current.id}`);
  await page.getByRole("button", { name: "Run context", exact: true }).click();
  await page.getByText("Compare a saved run", { exact: true }).click();
  const compare = page.getByRole("combobox", { name: "Comparison run", exact: true });
  await expect(compare.locator("option")).toHaveCount(3);
  await compare.selectOption(base.id);
  const setup = page.locator(".comparison-setup");
  await setup.getByText("Setup changes · 1 step", { exact: true }).click();
  const budgetChange = setup
    .locator(".comparison-changes > div")
    .filter({ hasText: "Total tokens allowed" });
  await expect(budgetChange).toContainText(/65(?:\D)?000/);
  await expect(setup.getByText("The order of shared pinned sources changed.")).toBeVisible();
  await expect(
    setup.getByRole("link", { name: `Pinned source · ${priorSource.slice(0, 8)}` }),
  ).toBeVisible();
  await expect(
    setup.getByRole("link", { name: `Pinned source · ${newSource.slice(0, 8)}` }),
  ).toBeVisible();
  await setup.getByText(`${first.label} · Changed`, { exact: true }).click();
  await expect(
    setup.getByText("Compare front-end and belly pricing over twenty sessions.", { exact: true }),
  ).toBeVisible();
  await expect(
    setup.locator(".comparison-changes > div").filter({ hasText: "Model override" }),
  ).toContainText("analysis-model");
  await expect(
    setup.locator(".comparison-changes > div").filter({ hasText: "Web and market search" }),
  ).toContainText("Disabled");
  await page.getByText("Output file changes (2)", { exact: true }).click();
  const outputs = page.locator(".comparison-output-changes");
  const price = outputs.getByRole("listitem").filter({ hasText: "pricing.csv" });
  const before = price.getByRole("region", { name: "Comparison run", exact: true });
  const after = price.getByRole("region", { name: "Open run", exact: true });
  await before.getByText("Preview", { exact: true }).click();
  await after.getByText("Preview", { exact: true }).click();
  await expect(before.getByRole("columnheader", { name: "change" })).toBeVisible();
  await expect(before.getByRole("cell", { name: "0.000", exact: true })).toBeVisible();
  await expect(before.getByRole("cell", { name: 'basis, "roll"', exact: true })).toBeVisible();
  await expect(after.getByRole("cell", { name: "018.000", exact: true })).toBeVisible();
  await expect(
    after.getByRole("cell", { name: "first line second line", exact: true }),
  ).toBeVisible();
  await expect(after.getByText("Showing 50 of 51 data rows and 20 of 21 columns.")).toBeVisible();
  await expect(after.getByRole("columnheader", { name: "measure_17", exact: true })).toHaveCount(1);
  await expect(after.getByRole("columnheader", { name: "measure_18", exact: true })).toHaveCount(0);
  const csvTable = after.getByRole("region", { name: "CSV preview table" });
  expect(await csvTable.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
    true,
  );
  const visibleArea = (await csvTable.boundingBox())!;
  const changeHeader = (await after
    .getByRole("columnheader", { name: "change", exact: true })
    .boundingBox())!;
  expect(changeHeader.x + changeHeader.width).toBeLessThanOrEqual(
    visibleArea.x + visibleArea.width,
  );
  await expect(after.getByRole("cell", { name: "70", exact: true })).toHaveCount(0);
  await after.getByText("Show raw CSV", { exact: true }).click();
  await expect(after.locator("pre")).toHaveText(bodies.get(newTable.artifact_id)!);
  await after.getByText("Show raw CSV", { exact: true }).click();
  await expect(after).toContainText("Pass 2");
  const mobileBefore = (await before.boundingBox())!;
  expect((await after.boundingBox())!.y).toBeGreaterThanOrEqual(
    mobileBefore.y + mobileBefore.height,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  const wideBefore = (await before.boundingBox())!;
  const wideAfter = (await after.boundingBox())!;
  expect(wideAfter.y).toBeCloseTo(wideBefore.y, 0);
  expect(wideAfter.x).toBeGreaterThanOrEqual(wideBefore.x + wideBefore.width);
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(outputs.getByRole("heading", { name: "controls.csv" })).toHaveCount(0);
  const removed = outputs.getByRole("listitem").filter({ hasText: "old-test.csv" });
  await expect(removed.getByRole("region", { name: "Open run" })).toContainText("No saved file");
  const raggedPreview = removed.getByRole("region", { name: "Comparison run" });
  await raggedPreview.getByText("Preview", { exact: true }).click();
  await expect(raggedPreview.getByText("Showing raw CSV.")).toBeVisible();
  await expect(raggedPreview.locator("pre")).toHaveText(bodies.get(oldOnly.artifact_id)!);
  const table = page.getByRole("region", { name: "Run comparison table" }).getByRole("table");
  const revisionsRow = table.getByRole("row", { name: "Workflow revision" });
  await expect(revisionsRow.getByRole("cell")).toHaveText(["13", "12"]);
  await expect(table.getByRole("row", { name: "Provider-reported models" })).toContainText(
    "analysis-model-snapshot",
  );
  await table.getByText("Reviewer feedback (1)", { exact: true }).click();
  await expect(table.getByText("Check the curve against the dollar.")).toBeVisible();
  await table.getByText("Latest model output · Write the discretionary macro memo").click();
  await expect(table.locator(".research-conclusion strong")).toHaveText(
    "The rival mechanism survived.",
  );
  await expect(page).toHaveURL(new RegExp(`run=${current.id}`));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await compare.selectOption(matchingOutputs.id);
  await page.getByText("Output file changes", { exact: true }).click();
  await expect(page.getByText("The latest saved files match.")).toBeVisible();
  await page.getByRole("button", { name: "Hide workflow map", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Show workflow map", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Run workflow graph", exact: true })).toHaveCount(
    0,
  );
});
