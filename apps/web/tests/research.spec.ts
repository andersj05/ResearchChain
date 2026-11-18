import { expect, test } from "./fixtures";
import example from "../../../examples/research-workflow.json";
import research from "../../../examples/hypothesis-research.json";
import { addTemplate, forkDefinition, referenceOf } from "../src/lib/workflow-editing";
import type { RunSnapshot, Workflow, WorkflowRevision } from "../src/lib/workflow";

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

test("change a model override from Build and Run setup before pinning the run", async ({
  page,
  request,
}) => {
  const saved = await request.post("/api/revisions", { data: research });
  await page.goto(`/?revision=${(await saved.json()).id}`);
  const workflowModel = page.getByRole("combobox", { name: "Workflow model", exact: true });
  const stepModel = page.getByRole("combobox", { name: "Step model", exact: true });
  await workflowModel.selectOption("test-model");
  await expect(stepModel).toHaveValue("");
  await stepModel.selectOption("test-model");
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Research model", exact: true })).toHaveValue(
    "test-model",
  );
  await page.getByText("Step models (1 override)", { exact: true }).click();
  const setupStepModel = page.getByRole("combobox", { name: "Form hypotheses", exact: true });
  await expect(setupStepModel).toHaveValue("test-model");
  await setupStepModel.selectOption("analysis-model");
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Needs review", {
    timeout: 30000,
  });
  const runId = new URL(page.url()).searchParams.get("run");
  const snapshot: RunSnapshot = await (await request.get(`/api/runs/${runId}`)).json();
  expect(snapshot.research_manifest?.settings.model).toBe("test-model");
  expect(snapshot.model_attempts?.[0]?.model).toBe("analysis-model");
});

test("reset unavailable and nested step models from Run setup on a phone", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const root = addTemplate(structuredClone(research) as Workflow, null, "subgraph", "challenge");
  const call = root.workflow.nodes.find((node) => node.id === root.selected)!;
  const ref = referenceOf(call)!;
  const nested = addTemplate(root.workflow, ref, "model", "step");
  const nestedStep = nested.workflow.subgraphs?.[0]?.nodes.find(
    (node) => node.id === nested.selected,
  );
  const plan = nested.workflow.nodes.find((node) => node.id === "plan");
  if (nestedStep?.config?.type !== "research" || plan?.config?.type !== "research") {
    throw new Error("Expected root and nested research steps.");
  }
  nestedStep.config.model = "retired-model";
  plan.config.model = "analysis-model";
  const fixture = forkDefinition(nested.workflow, ref);
  const original = await request.post("/api/revisions", { data: fixture.workflow });
  expect(original.ok(), await original.text()).toBe(true);
  await page.goto(`/?revision=${(await original.json()).id}`);
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Research model", exact: true })
    .selectOption("test-model");
  const start = page.getByRole("button", { name: "Start run", exact: true });
  await expect(start).toBeDisabled();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("choose a replacement");
  await page.getByText("Step models (2 overrides)", { exact: true }).click();
  const nestedModel = page.getByRole("combobox", { name: "Model prompt · New subgraph v1" });
  await expect(nestedModel.locator("option:checked")).toHaveText("retired-model (unavailable)");
  await expect(page.getByRole("combobox", { name: "Model prompt · New subgraph v2" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Use workflow default for all steps" }).click();
  await expect(page.getByText("Step models (0 overrides)", { exact: true })).toBeVisible();
  await expect(nestedModel.locator("option:checked")).toHaveText("Workflow default · test-model");
  await expect(start).toBeEnabled();
  await page.getByRole("button", { name: "Close run setup" }).click();
  await page.getByRole("button", { name: "Save revision", exact: true }).click();
  await expect(page.getByRole("status", { name: "Workspace status" })).toHaveText(
    /^Revision \d+ saved\.$/,
  );
  const revisionId = new URL(page.url()).searchParams.get("revision");
  const saved: WorkflowRevision = await (await request.get(`/api/revisions/${revisionId}`)).json();
  expect(saved.workflow.nodes.find((node) => node.id === "plan")?.config).not.toHaveProperty(
    "model",
  );
  expect(
    saved.workflow.subgraphs?.[0]?.nodes.find((node) => node.id === nested.selected)?.config,
  ).not.toHaveProperty("model");
  expect(
    saved.workflow.subgraphs?.[1]?.nodes.find((node) => node.id === nested.selected)?.config,
  ).toMatchObject({ model: "retired-model" });
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
    await expect(page.getByRole("status", { name: "Run status" })).toHaveText(
      "Needs review",
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
    await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Needs review");
    const snapshot: RunSnapshot = await (await request.get(`/api/runs/${runId}`)).json();
    expect(snapshot.model_attempts).toHaveLength(3);
    await page.getByRole("button", { name: "Run context", exact: true }).click();
    await page.getByText("Research manifest", { exact: true }).click();
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
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download research manifest", exact: true }).click();
    expect((await download).suggestedFilename()).toBe(`research-${runId}.json`);
    await page.getByRole("button", { name: "Return to review", exact: true }).click();
    await page.getByRole("button", { name: "Approve and continue", exact: true }).click();
    await expect(page.getByRole("status", { name: "Run status" })).toHaveText(
      "Completed",
      executionWait,
    );
    await page.reload();
    await expect(page.getByRole("status", { name: "Run status" })).toHaveText(
      "Completed",
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
  await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Running");
  await expect(page.getByRole("region", { name: "Research results" })).toContainText("requesting");
  const choose = page.getByRole("combobox", { name: "Inspect step" });
  await choose.selectOption("root/revise");
  const runUrl = new URL(page.url());
  await page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/runs/${runUrl.searchParams.get("run")}`) && response.ok(),
  );
  await expect(choose).toHaveValue("root/revise");
  await page.getByRole("button", { name: "Follow run", exact: true }).click();
  await expect(choose).toHaveValue("root/plan");
  await page.getByRole("button", { name: "Cancel run", exact: true }).click();
  await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Cancelled");
  await expect(page.getByText("Saved response (unvalidated)", { exact: true })).toBeVisible();
  const runId = new URL(page.url()).searchParams.get("run");
  await expect
    .poll(async () => (await (await request.get(`/api/runs/${runId}`)).json()).execution_pending)
    .toBe(false);
  await page.reload();
  await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Cancelled");
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
  const dialog = page.getByRole("dialog", { name: "Start a research run" });
  const limits = dialog.getByText(/^Run limits ·/);
  const start = dialog.getByRole("button", { name: "Start run", exact: true });
  await limits.click();
  const modelAttempts = dialog.getByRole("spinbutton", { name: "Maximum model attempts" });
  await expect(modelAttempts).toHaveValue("0");
  await modelAttempts.fill("101");
  await limits.click();
  await expect(modelAttempts).toBeHidden();
  await start.click();
  await expect(modelAttempts).toBeFocused();
  await modelAttempts.fill("0");
  await dialog.getByRole("spinbutton", { name: "Maximum active seconds" }).fill("270");
  await expect(limits).toHaveText("Run limits · 270s active · 0 model attempts");
  await start.click();
  await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Limit reached");
  await expect(page.getByRole("region", { name: "Run inspector" })).toContainText(
    "Model-call budget reached.",
  );
  const runId = new URL(page.url()).searchParams.get("run");
  const snapshot: RunSnapshot = await (await request.get(`/api/runs/${runId}`)).json();
  expect(snapshot.workflow.budgets?.max_active_seconds).toBe(270);
  expect(snapshot.research_manifest?.settings.limits?.max_model_calls).toBe(0);
});
