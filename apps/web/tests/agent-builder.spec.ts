import { expect, test } from "./fixtures";
import type { RunSnapshot } from "../src/lib/workflow";

for (const width of [1440, 390]) {
  test(`build a custom agent and iterate with human feedback at ${width}px`, async ({
    page,
    request,
  }, testInfo) => {
    testInfo.setTimeout(90000);
    await page.setViewportSize({ width, height: 1000 });
    const sourceTitle = `Builder source ${crypto.randomUUID()}`;
    const source = await request.post("/api/evidence", {
      data: {
        id: crypto.randomUUID(),
        title: sourceTitle,
        kind: "text",
        publisher: "Synthetic test",
        text: "A short source for the owner's experiment.",
        rights: "owned",
      },
    });
    expect(source.ok()).toBeTruthy();
    const evidenceId = (await source.json()).id;
    await page.goto("/");
    await page.getByRole("button", { name: "New workflow", exact: true }).click();
    await page.getByText("Build your agent", { exact: true }).click();
    await expect(page.getByText(/Templates are optional examples/)).toBeVisible();
    await page.getByText("Build your agent", { exact: true }).click();
    await page.getByText("Workflow settings", { exact: true }).click();
    await page
      .getByRole("textbox", { name: "Workflow name", exact: true })
      .fill(`My agent ${width}`);
    await page.getByRole("button", { name: "Add model prompt", exact: true }).click();
    await page.getByRole("textbox", { name: "Step name", exact: true }).fill("Draft");
    await page
      .getByRole("textbox", { name: "Instructions", exact: true })
      .fill("Write a short outline using my brief.");
    await expect(page.getByRole("combobox", { name: "Step behavior", exact: true })).toHaveValue(
      "custom",
    );
    await page.getByRole("button", { name: "Add human review", exact: true }).click();
    await page.getByRole("textbox", { name: "Step name", exact: true }).fill("Checkpoint");
    const question = page.getByRole("textbox", { name: "Review question", exact: true });
    await expect(question).toHaveAttribute("placeholder", "Continue this workflow?");
    await question.fill("What should change?");
    await page.getByRole("button", { name: "Add model prompt", exact: true }).click();
    await page.getByRole("textbox", { name: "Step name", exact: true }).fill("Improve");
    await page
      .getByRole("textbox", { name: "Instructions", exact: true })
      .fill("Revise the outline using my feedback.");
    await page
      .getByRole("combobox", { name: "Context input", exact: true })
      .selectOption({ label: "Draft · text" });
    await page
      .getByRole("combobox", { name: "Reviewer feedback", exact: true })
      .selectOption({ label: "Checkpoint · feedback" });
    await page.getByRole("button", { name: "Validate workflow", exact: true }).click();
    await expect(page.getByRole("status", { name: "Workspace status" })).toHaveText(
      "Workflow valid. Ready to run.",
    );
    await page.screenshot({ path: testInfo.outputPath("agent-builder.png"), fullPage: true });
    await page.getByRole("button", { name: "Run workflow", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Research brief", exact: true })
      .fill("My independent experiment");
    await expect(page.getByText("Connected as Synthetic", { exact: true })).toBeVisible();
    await page
      .getByRole("combobox", { name: "Research model", exact: true })
      .selectOption("test-model");
    await page.getByRole("checkbox", { name: new RegExp(sourceTitle) }).check();
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Needs review", {
      timeout: 30000,
    });
    const runId = new URL(page.url()).searchParams.get("run")!;
    await page
      .getByRole("textbox", { name: "Reviewer feedback", exact: true })
      .fill("Use two bullets.");
    await page.getByRole("button", { name: "Approve and continue", exact: true }).click();
    await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Completed", {
      timeout: 30000,
    });
    const first: RunSnapshot = await (await request.get(`/api/runs/${runId}`)).json();
    expect(first.model_attempts).toHaveLength(2);
    expect(first.model_attempts![1]!.result!.hypotheses).toEqual([]);
    const captured = await request.get(
      `/api/artifacts/${encodeURIComponent(first.model_attempts![1]!.input_artifact_id!)}/content`,
    );
    expect(await captured.text()).toContain("Use two bullets.");
    await page.reload();
    await page.getByRole("button", { name: "Iterate from this run", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Build", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page
      .getByRole("textbox", { name: "Instructions", exact: true })
      .fill("Write a revised outline in three bullets.");
    await page.getByRole("button", { name: "Run workflow", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Research brief", exact: true })).toHaveValue(
      "My independent experiment",
    );
    await expect(page.getByRole("checkbox", { name: new RegExp(sourceTitle) })).toBeChecked();
    await expect(
      page.getByRole("link", { name: `Baseline run · ${runId.slice(0, 8)}` }),
    ).toHaveAttribute("href", `?view=runs&run=${runId}`);
    await expect(page.getByRole("combobox", { name: "Research model", exact: true })).toHaveValue(
      "test-model",
    );
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Needs review", {
      timeout: 30000,
    });
    const nextId = new URL(page.url()).searchParams.get("run")!;
    expect(nextId).not.toBe(runId);
    const second: RunSnapshot = await (await request.get(`/api/runs/${nextId}`)).json();
    expect(second.revision_id).not.toBe(first.revision_id);
    expect(second.baseline_run_id).toBe(runId);
    expect(second.evidence_ids).toEqual([evidenceId]);
    expect((await (await request.get(`/api/runs/${runId}`)).json()).workflow).toEqual(
      first.workflow,
    );
    await page.getByRole("button", { name: "Compare with baseline", exact: true }).click();
    const compare = page.getByRole("combobox", { name: "Comparison run", exact: true });
    await expect(compare).toHaveValue(runId);
    await expect(page.getByRole("region", { name: "Run comparison table" })).toBeVisible();
    await page.reload();
    await expect(compare).toHaveValue(runId);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath("agent-iteration.png"), fullPage: true });
  });
}
