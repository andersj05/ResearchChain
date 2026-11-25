import { expect, test, type Locator, type Page } from "./fixtures";
import {
  discretionaryMacroWorkflow,
  type RunSnapshot,
  type WorkflowRevision,
} from "../src/lib/workflow";

function makeLongRun() {
  const template = structuredClone(discretionaryMacroWorkflow);
  const sample = template.nodes.find((node) => node.id === "pricing")!;
  const final = template.nodes.find((node) => node.id === "finish")!;
  const steps = Array.from({ length: 12 }, (_, index) => ({
    ...sample,
    id: `measure-${index + 1}`,
    label: `Check factor ${index + 1}`,
    inputs: {},
    position: { x: 80 + index * 140, y: 150 },
  }));
  const workflow = {
    ...template,
    name: "Synthetic long model activity",
    start_node: steps[0]!.id,
    nodes: [...steps, final],
    edges: steps.map((step, index) => ({
      source: step.id,
      target: steps[index + 1]?.id ?? final.id,
      source_port: "next",
      target_port: "in",
    })),
  };
  const stamp = (seconds: number) => new Date(Date.UTC(2026, 10, 24, 10, 0, seconds)).toISOString();
  const revision: WorkflowRevision = {
    id: crypto.randomUUID(),
    name: workflow.name,
    number: 1,
    content_hash: "0123456789abcdef",
    created_at: stamp(0),
    workflow,
  };
  const attempts = steps.flatMap((step, stepIndex) =>
    Array.from({ length: 6 }, (_, index) => {
      const sequence = stepIndex * 6 + index;
      return {
        id: crypto.randomUUID(),
        path: `root/${step.id}${index ? `/analyst-pass-${index + 1}` : ""}`,
        stage: "custom" as const,
        status: "completed" as const,
        model: index ? "synthetic-target-model" : "other-synthetic-model",
        input_bytes: 301,
        output_characters: 75,
        input_tokens: 700 + sequence,
        output_tokens: 80 + sequence,
        created_at: stamp(sequence * 90),
        finished_at: stamp(sequence * 90 + sequence + 5),
        result: {
          schema_version: "research-result-1" as const,
          stage: "custom" as const,
          conclusion: `Exact saved receipt ${sequence + 1} for the synthetic factor check.`,
          revision_summary: "",
          hypotheses: [],
          limitations: [],
          unresolved_questions: [],
          evidence_requests: [],
        },
      };
    }),
  );
  const run: RunSnapshot = {
    id: crypto.randomUUID(),
    revision_id: revision.id,
    revision_number: 1,
    workflow,
    workflow_name: workflow.name,
    status: "completed",
    execution_pending: false,
    created_at: stamp(0),
    compiler_version: "research-0.3.0",
    checkpoint_id: null,
    brief: "Synthetic multi-step model experiment.",
    events: [],
    artifacts: [],
    model_attempts: attempts,
  };
  return { run, revision };
}

function scrollPosition(opener: Locator) {
  return opener.evaluate((element) => ({
    page: Math.round(window.scrollY),
    pane: Math.round(element.closest(".run-reading-pane")!.scrollTop),
    row: Math.round(element.getBoundingClientRect().top),
  }));
}

async function openActivity(page: Page, width: number, runId: string) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(`/?view=runs&run=${runId}`);
  await page.getByRole("button", { name: "Model activity", exact: true }).click();
  const activity = page.getByRole("region", { name: "Model attempts", exact: true });
  const filter = activity.getByRole("searchbox", { name: "Filter model activity" });
  const sort = activity.getByRole("combobox", { name: "Sort model activity" });
  await filter.fill("synthetic-target");
  await sort.selectOption("elapsed");
  const step = page.getByRole("region", { name: "Selected step", exact: true });
  return {
    activity,
    filter,
    sort,
    step,
    back: step.getByRole("button", { name: "Back to model activity", exact: true }),
    receipt: step.locator(".research-attempt[open]"),
  };
}

for (const { width, timeline } of [
  { width: 390, timeline: false },
  { width: 1440, timeline: false },
  { width: 390, timeline: true },
]) {
  test(`return to the exact ${timeline ? "timeline" : "table"} receipt at ${width}px`, async ({
    page,
  }) => {
    const { run, revision } = makeLongRun();
    await page.route(`**/api/runs/${run.id}`, (route) => route.fulfill({ json: run }));
    await page.route(`**/api/revisions/${revision.id}`, (route) =>
      route.fulfill({ json: revision }),
    );
    await page.addInitScript(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.endsWith(".model-activity-order") || key.endsWith(".model-activity-display"))
          throw new DOMException("Synthetic storage limit", "QuotaExceededError");
        return setItem.call(this, key, value);
      };
    });
    const { activity, filter, sort, step, back, receipt } = await openActivity(page, width, run.id);
    const display = activity.getByRole("combobox", { name: "Display model activity" });
    const range = activity.getByRole("combobox", { name: "Timeline range" });
    const table = activity.getByRole("region", { name: "Model activity table", exact: true });
    const chart = activity.getByRole("region", { name: "Model activity timeline", exact: true });
    const factor = timeline ? 11 : 2;
    const entryName = `Check factor ${factor} · Pass 5`;
    const result = `Exact saved receipt ${(factor - 1) * 6 + 5} for the synthetic factor check.`;
    const exactAttempt = run.model_attempts![(factor - 1) * 6 + 4]!;
    if (timeline) {
      await display.selectOption("timeline");
      await range.selectOption("filtered");
      await expect(chart.getByRole("listitem")).toHaveCount(60);
    } else {
      await expect(table.getByRole("row")).toHaveCount(61);
    }
    const opener = (timeline ? chart : table).getByRole("button", { name: entryName, exact: true });
    await opener.scrollIntoViewIfNeeded();
    await opener.focus();
    const before = await scrollPosition(opener);
    expect(Math.max(before.page, before.pane)).toBeGreaterThan(1000);
    await opener.press("Enter");
    await expect(receipt.locator("summary").first()).toContainText(entryName);
    await expect(receipt).toContainText(result);
    await expect(back).toBeInViewport();
    await back.press("Enter");
    await expect(filter).toHaveValue("synthetic-target");
    await expect(display).toHaveValue(timeline ? "timeline" : "table");
    await expect(opener).toBeFocused();
    await expect(opener).toBeInViewport({ ratio: 0.9 });
    const after = await scrollPosition(opener);
    expect(Math.abs(after.row - before.row)).toBeLessThanOrEqual(12);
    expect(Math.abs(after.page - before.page)).toBeLessThanOrEqual(timeline ? 24 : 12);
    expect(Math.abs(after.pane - before.pane)).toBeLessThanOrEqual(12);
    if (timeline) {
      await expect(range).toHaveValue("filtered");
      await display.selectOption("table");
    }
    await expect(sort).toHaveValue("elapsed");

    if (timeline) {
      await page.goto(`/?view=runs&run=${run.id}&attempt=${exactAttempt.id}`);
      await expect(receipt.locator("summary").first()).toContainText(entryName);
      await expect(receipt).toContainText(result);
      await expect(back).toHaveCount(0);
      await step.getByRole("button", { name: "Model activity for this step", exact: true }).click();
      await expect(filter).toBeEmpty();
      await expect(
        activity.getByRole("combobox", { name: "Workflow step", exact: true }),
      ).toHaveValue(`root/measure-${factor}`);
    }
  });
}

test("return focuses the activity filter if an exact receipt disappeared", async ({ page }) => {
  const { run, revision } = makeLongRun();
  const exactAttempt = run.model_attempts![10]!;
  let attempts = run.model_attempts;
  await page.route(`**/api/runs/${run.id}`, (route) =>
    route.fulfill({
      json: { ...run, status: "running", execution_pending: true, model_attempts: attempts },
    }),
  );
  await page.route(`**/api/revisions/${revision.id}`, (route) => route.fulfill({ json: revision }));
  const { activity, filter, sort, back, receipt } = await openActivity(page, 390, run.id);
  const opener = activity.getByRole("button", { name: "Check factor 2 · Pass 5", exact: true });
  await opener.click();
  await expect(receipt).toContainText("Exact saved receipt 11 for the synthetic factor check.");
  attempts = attempts!.filter((item) => item.id !== exactAttempt.id);
  await expect(receipt).toHaveCount(0);
  await back.press("Enter");
  await expect(filter).toHaveValue("synthetic-target");
  await expect(sort).toHaveValue("elapsed");
  await expect(filter).toBeFocused();
  await expect(filter).toBeInViewport();
  await expect(opener).toHaveCount(1);
  await expect(opener).not.toHaveAttribute("data-model-activity-attempt", exactAttempt.id);
});
