import { expect, test } from "./fixtures";
import {
  discretionaryMacroWorkflow,
  type RunSnapshot,
  type WorkflowRevision,
} from "../src/lib/workflow";
import { addTemplate, referenceOf } from "../src/lib/workflow-editing";

test("sort model activity by measured work and remember the preference", async ({ page }) => {
  const stamp = (minute: number) => new Date(Date.UTC(2026, 10, 18, 15, minute)).toISOString();
  const loop = addTemplate(structuredClone(discretionaryMacroWorkflow), null, "loop", "activity");
  const loopRef = referenceOf(loop.workflow.nodes.find((node) => node.id === loop.selected)!)!;
  const body = addTemplate(loop.workflow, loopRef, "model", "pass");
  const firstIteration = `root/${loop.selected}/iteration-1/${body.selected}`;
  const secondIteration = `root/${loop.selected}/iteration-2/${body.selected}`;
  const revision: WorkflowRevision = {
    id: crypto.randomUUID(),
    name: discretionaryMacroWorkflow.name,
    number: 1,
    content_hash: "0123456789abcdef",
    created_at: stamp(0),
    workflow: body.workflow,
  };
  const attempt = {
    stage: "custom",
    input_bytes: 100,
    output_characters: 30,
  } as const;
  const snapshot: RunSnapshot = {
    id: crypto.randomUUID(),
    revision_id: revision.id,
    revision_number: 1,
    workflow: body.workflow,
    workflow_name: revision.name,
    status: "running",
    execution_pending: true,
    created_at: stamp(0),
    compiler_version: "research-0.3.0",
    checkpoint_id: null,
    brief: "Compare synthetic activity metrics.",
    events: [],
    artifacts: [],
    model_attempts: [
      {
        ...attempt,
        id: crypto.randomUUID(),
        path: firstIteration,
        status: "completed",
        model: "slow-partial-model",
        input_tokens: 450,
        created_at: stamp(1),
        finished_at: stamp(6),
      },
      {
        ...attempt,
        id: crypto.randomUUID(),
        path: `${firstIteration}/analyst-pass-2`,
        status: "completed",
        model: "fast-metered-model",
        input_tokens: 12,
        output_tokens: 11,
        created_at: stamp(2),
        finished_at: stamp(3),
      },
      {
        ...attempt,
        id: crypto.randomUUID(),
        path: secondIteration,
        status: "completed",
        model: "zero-tokens-model",
        input_tokens: 0,
        output_tokens: 0,
        created_at: stamp(4),
        finished_at: stamp(4),
      },
      {
        ...attempt,
        id: crypto.randomUUID(),
        path: "root/memo",
        status: "requesting",
        model: "active-model",
        created_at: stamp(7),
      },
    ],
  };
  await page.route(`**/api/runs/${snapshot.id}`, (route) => route.fulfill({ json: snapshot }));
  await page.route(`**/api/revisions/${revision.id}`, (route) => route.fulfill({ json: revision }));
  await page.setViewportSize({ width: 390, height: 950 });
  await page.goto(`/?run=${snapshot.id}&view=runs`);
  const activity = page.getByRole("button", { name: "Model activity", exact: true });
  await activity.click();
  const order = page.getByRole("combobox", { name: "Sort model activity" });
  const rows = page.getByRole("region", { name: "Model attempts", exact: true }).getByRole("row");
  await expect(rows.nth(1)).toContainText("active-model");
  await order.selectOption("elapsed");
  await expect(rows.nth(1)).toContainText("slow-partial-model");
  await expect(rows.nth(3)).toContainText("zero-tokens-model");
  await expect(rows.nth(4)).toContainText("active-model");
  await order.selectOption("tokens");
  await expect(
    page.getByText("Attempts with a missing token count follow complete totals."),
  ).toBeVisible();
  await expect(rows.nth(1)).toContainText("fast-metered-model");
  await expect(rows.nth(2)).toContainText("zero-tokens-model");
  await expect(rows.nth(4)).toContainText("slow-partial-model");
  await page.reload();
  await activity.click();
  await expect(order).toHaveValue("tokens");
  await expect(rows.nth(1)).toContainText("fast-metered-model");
  const display = page.getByRole("combobox", { name: "Display model activity" });
  await display.selectOption("timeline");
  const timeline = page.getByRole("region", { name: "Model activity timeline" });
  const entries = timeline.getByRole("listitem");
  await expect(entries).toHaveCount(4);
  await expect(entries.nth(0)).toContainText("Start +0 s · 300 s elapsed");
  await expect(entries.nth(1)).toContainText("Start +60 s · 60 s elapsed");
  await expect(entries.nth(2)).toContainText("Start +180 s · 0 s elapsed");
  await expect(entries.nth(3)).toContainText("Start +360 s · Duration unavailable");
  const longBar = (await entries.nth(0).locator(".model-timeline-mark").boundingBox())!;
  const shortBar = (await entries.nth(1).locator(".model-timeline-mark").boundingBox())!;
  expect(shortBar.x).toBeGreaterThan(longBar.x);
  expect(shortBar.x + shortBar.width).toBeLessThan(longBar.x + longBar.width);
  const firstButton = (await entries.nth(0).getByRole("button").boundingBox())!;
  expect(firstButton.x + firstButton.width).toBeLessThan(longBar.x);
  await display.selectOption("table");
  await expect(order).toHaveValue("tokens");
  await page.getByRole("searchbox", { name: "Filter model activity" }).fill("partial");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("slow-partial-model");
  await display.selectOption("timeline");
  await expect(entries).toHaveCount(1);
  await expect(timeline.getByText("360 s", { exact: true })).toBeVisible();
  const range = page.getByRole("combobox", { name: "Timeline range" });
  await range.selectOption("filtered");
  await expect(timeline.getByText("Time since the first matching model attempt")).toBeVisible();
  await expect(timeline.getByText("300 s", { exact: true })).toBeVisible();
  await expect(timeline.getByText("360 s", { exact: true })).toHaveCount(0);
  await range.selectOption("full");
  await expect(timeline.getByText("360 s", { exact: true })).toBeVisible();
  await range.selectOption("filtered");
  await entries.nth(0).getByRole("button").click();
  const step = page.getByRole("region", { name: "Selected step" });
  const expanded = step.locator(".research-attempt[open] > summary");
  await expect(expanded).toContainText("Pass 1");
  await activity.click();
  await expect(page.getByRole("searchbox", { name: "Filter model activity" })).toHaveValue(
    "partial",
  );
  await expect(range).toHaveValue("filtered");
  await expect(entries).toHaveCount(1);
  await expect(timeline.getByText("300 s", { exact: true })).toBeVisible();
  await entries.nth(0).getByRole("button").click();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await step.getByRole("button", { name: "Copy attempt link", exact: true }).click();
  await expect(step.getByText("Attempt link copied.")).toBeVisible();
  const link = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  expect(link.searchParams.get("run")).toBe(snapshot.id);
  expect(link.searchParams.get("attempt")).toBe(snapshot.model_attempts![0]!.id);
  expect([...link.searchParams.keys()]).toEqual(["view", "run", "attempt"]);
  await page.goto(link.href);
  await expect(expanded).toContainText("Pass 1");
  await expect(step).toContainText("slow-partial-model");
  await expect(page.getByRole("group", { name: "Latest workflow activity" })).toBeVisible();
  await step.getByRole("button", { name: "Model activity for this step", exact: true }).click();
  await expect(display).toHaveValue("timeline");
  const scope = page.getByRole("combobox", { name: "Workflow step", exact: true });
  await expect(scope).toHaveValue(firstIteration);
  await expect(scope.locator("option:checked")).toHaveText(/Iteration 1/);
  await expect(entries).toHaveCount(2);
  await range.selectOption("filtered");
  await expect(timeline.getByText("Time since the first matching model attempt")).toBeVisible();
  await entries.nth(1).getByRole("button").click();
  await expect(expanded).toContainText("Pass 2");
  await activity.click();
  await expect(scope).toHaveValue(firstIteration);
  await scope.selectOption(secondIteration);
  await expect(entries).toHaveCount(1);
  await expect(entries.nth(0)).toContainText("zero-tokens-model");
  await scope.selectOption("");
  await expect(entries).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
