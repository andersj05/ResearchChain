import { expect, test } from "./fixtures";
import example from "../../../examples/research-workflow.json";
import research from "../../../examples/hypothesis-research.json";
import { addTemplate } from "../src/lib/workflow-editing";
import type { RunSnapshot, Workflow } from "../src/lib/workflow";

async function prepare(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
) {
  const saved = await request.post("/api/revisions", { data: example });
  await page.goto(`/?revision=${(await saved.json()).id}`);
  await expect(page.getByRole("combobox", { name: "Workflow model", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Use research template", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Workflow model", exact: true })).toHaveValue(
    research.research.model,
  );
  await expect(
    page.getByRole("combobox", { name: "Step model", exact: true }).locator("option:checked"),
  ).toHaveText(`Workflow default · ${research.research.model}`);
  await page.getByRole("button", { name: "Validate workflow", exact: true }).click();
  await expect(page.getByRole("status", { name: "Workspace status" })).toHaveText(
    "Workflow valid. Ready to run.",
  );
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  await expect(page.getByText("Connected as Synthetic", { exact: true })).toBeVisible();
  await page
    .getByRole("combobox", { name: "Research model", exact: true })
    .selectOption("test-model");
  await expect(page.getByRole("button", { name: "Start run", exact: true })).toBeEnabled();
}

test("choose a workflow default and override one step from the graph", async ({
  page,
  request,
}) => {
  const saved = await request.post("/api/revisions", { data: research });
  await page.goto(`/?revision=${(await saved.json()).id}`);
  const workflowModel = page.getByRole("combobox", { name: "Workflow model", exact: true });
  const stepModel = page.getByRole("combobox", { name: "Step model", exact: true });
  await workflowModel.selectOption("test-model");
  await expect(stepModel).toHaveValue("");
  await stepModel.selectOption("analysis-model");
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Research model", exact: true })).toHaveValue(
    "test-model",
  );
  await page.getByText("Step model overrides (1)", { exact: true }).click();
  await expect(page.locator(".step-model-list")).toContainText("analysis-model");
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Run paused", exact: true })).toBeVisible({
    timeout: 30000,
  });
  const runId = new URL(page.url()).searchParams.get("run");
  const snapshot: RunSnapshot = await (await request.get(`/api/runs/${runId}`)).json();
  expect(snapshot.research_manifest?.settings.model).toBe("test-model");
  expect(snapshot.model_attempts?.[0]?.model).toBe("analysis-model");
});

for (const width of [1440, 390]) {
  test(`research reviews, saved outputs and manifest on ${width}px screen`, async ({
    page,
    request,
  }, testInfo) => {
    // Accepted work shares two durable worker slots with other browser cases.
    // Bound execution waits separately from immediate interface assertions.
    testInfo.setTimeout(60000);
    const executionWait = { timeout: 30000 };
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await prepare(page, request);
    await page.screenshot({ path: testInfo.outputPath("research-setup.png"), fullPage: true });
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Run paused", exact: true })).toBeVisible(
      executionWait,
    );
    await expect(page.getByRole("region", { name: "Research results" })).toContainText(
      "A temporary measurement effect.",
    );
    const runId = new URL(page.url()).searchParams.get("run")!;
    await page
      .getByRole("textbox", { name: "Reviewer feedback", exact: true })
      .fill("Seek independent observations before concluding.");
    await page.getByRole("button", { name: "Approve and continue", exact: true }).click();
    // Wait for the next durable checkpoint, not a transient running frame
    // or the previous review still visible while its command is queued.
    await expect(page.locator('[aria-label="Review final_review"]')).toBeVisible(executionWait);
    await expect(page.getByRole("heading", { name: "Run paused", exact: true })).toBeVisible();
    const snapshot: RunSnapshot = await (await request.get(`/api/runs/${runId}`)).json();
    expect(snapshot.model_attempts).toHaveLength(3);
    const modelSummary = page.getByRole("region", { name: "Run model", exact: true });
    await expect(modelSummary).toContainText("Selected modeltest-model");
    await expect(modelSummary).toContainText("ChatGPT included plan");
    for (const attempt of snapshot.model_attempts ?? []) {
      if (attempt.returned_model) await expect(modelSummary).toContainText(attempt.returned_model);
    }
    expect(snapshot.usage?.input_tokens).toBe(75);
    const input = snapshot.model_attempts![1]!.input_artifact_id!;
    const captured = await request.get(`/api/artifacts/${encodeURIComponent(input)}/content`);
    expect(await captured.text()).toContain("Seek independent observations before concluding.");
    await page.getByRole("region", { name: "Run inspector" }).evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({ path: testInfo.outputPath("research-results.png"), fullPage: true });
    await page.getByText("Research manifest", { exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download research manifest", exact: true }).click();
    expect((await download).suggestedFilename()).toBe(`research-${runId}.json`);
    await page.getByRole("button", { name: "Approve and continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Run completed", exact: true })).toBeVisible(
      executionWait,
    );
    await page.reload();
    await expect(page.getByRole("heading", { name: "Run completed", exact: true })).toBeVisible(
      executionWait,
    );
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("cancel an active research response in the separate worker", async ({ page, request }) => {
  await prepare(page, request);
  await page
    .getByRole("textbox", { name: "Research brief", exact: true })
    .fill("Wait for cancellation");
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Run running", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Research results" })).toContainText("requesting");
  await page.getByRole("button", { name: "Cancel run", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Run cancelled", exact: true })).toBeVisible();
  await expect(page.getByText("Saved response (unvalidated)", { exact: true })).toBeVisible();
  const runId = new URL(page.url()).searchParams.get("run");
  await expect
    .poll(async () => (await (await request.get(`/api/runs/${runId}`)).json()).execution_pending)
    .toBe(false);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Run cancelled", exact: true })).toBeVisible();
});

test("research settings survive structural edits and zero budgets", async ({ page, request }) => {
  const added = addTemplate(structuredClone(research) as Workflow, null, "subgraph", "plan");
  expect(added.workflow.schema_version).toBe("0.3");
  expect((await request.post("/api/workflows/validate", { data: added.workflow })).status()).toBe(
    200,
  );
  await prepare(page, request);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByText("Research limits", { exact: true }).click();
  await page.getByRole("spinbutton", { name: "Maximum model attempts", exact: true }).fill("0");
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  await expect(page.getByText("Connected as Synthetic", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Run limited", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Run inspector" })).toContainText(
    "Model-call budget reached.",
  );
});
