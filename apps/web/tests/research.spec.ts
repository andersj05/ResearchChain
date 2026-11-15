import { expect, test } from "@playwright/test";
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
  await page.getByRole("button", { name: "Use research template", exact: true }).click();
  await page.getByRole("button", { name: "Validate workflow", exact: true }).click();
  await expect(page.getByRole("status", { name: "Workspace status" })).toHaveText(
    "Workflow valid. Ready to run.",
  );
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  await expect(page.getByText("Connected as Synthetic", { exact: true })).toBeVisible();
  await page
    .getByRole("combobox", { name: "Research model", exact: true })
    .selectOption("test-model");
}

for (const width of [1440, 390]) {
  test(`research reviews, saved outputs and manifest on ${width}px screen`, async ({
    page,
    request,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await prepare(page, request);
    await page.screenshot({ path: testInfo.outputPath("research-setup.png"), fullPage: true });
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Run paused", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Research results" })).toContainText(
      "A temporary measurement effect.",
    );
    const runId = new URL(page.url()).searchParams.get("run")!;
    await page
      .getByRole("textbox", { name: "Reviewer feedback", exact: true })
      .fill("Seek independent observations before concluding.");
    await page.getByRole("button", { name: "Approve and continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Run running", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Run paused", exact: true })).toBeVisible();
    await expect(page.locator('[aria-label="Review final_review"]')).toBeVisible();
    const snapshot: RunSnapshot = await (await request.get(`/api/runs/${runId}`)).json();
    expect(snapshot.model_attempts).toHaveLength(3);
    expect(snapshot.usage?.input_tokens).toBe(75);
    const input = snapshot.model_attempts![1]!.input_artifact_id!;
    const captured = await request.get(`/api/artifacts/${encodeURIComponent(input)}/content`);
    expect(await captured.text()).toContain("Seek independent observations before concluding.");
    await page.screenshot({ path: testInfo.outputPath("research-results.png"), fullPage: true });
    await page.getByText("Research manifest", { exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download research manifest", exact: true }).click();
    expect((await download).suggestedFilename()).toBe(`research-${runId}.json`);
    await page.getByRole("button", { name: "Approve and continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Run completed", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Run completed", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("cancel a live response while the start request is pending", async ({ page, request }) => {
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
