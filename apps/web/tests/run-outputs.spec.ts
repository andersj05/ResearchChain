import { expect, test } from "./fixtures";
import {
  discretionaryMacroWorkflow,
  type RunSnapshot,
  type WorkflowRevision,
} from "../src/lib/workflow";
import { addTemplate, referenceOf } from "../src/lib/workflow-editing";

test("find saved outputs across iterations while a review is pending", async ({ page }, info) => {
  const loop = addTemplate(structuredClone(discretionaryMacroWorkflow), null, "loop", "activity");
  const loopStep = loop.workflow.nodes.find((node) => node.id === loop.selected)!;
  loopStep.label = "Challenge loop";
  const body = addTemplate(loop.workflow, referenceOf(loopStep)!, "model", "pass");
  const code = addTemplate(body.workflow, null, "code", loop.selected);
  const note = addTemplate(code.workflow, null, "note", code.selected);
  const inIteration = (number: number) =>
    `root/${loop.selected}/iteration-${number}/${body.selected}`;
  const created_at = "2026-11-19T15:00:00Z";
  const revision: WorkflowRevision = {
    id: crypto.randomUUID(),
    name: note.workflow.name,
    number: 1,
    content_hash: "0123456789abcdef",
    created_at,
    workflow: note.workflow,
  };
  const attempt = (
    path: string,
    conclusion: string,
    next_lead?: string,
  ): NonNullable<RunSnapshot["model_attempts"]>[number] => ({
    id: crypto.randomUUID(),
    path,
    model: "test-model",
    status: "completed",
    stage: "custom",
    input_bytes: 10,
    output_characters: conclusion.length,
    created_at,
    result: {
      schema_version: "research-result-1",
      stage: "custom",
      conclusion,
      next_lead,
      hypotheses: [],
      unresolved_questions: [],
      evidence_requests: [],
      revision_summary: "",
      limitations: [],
    },
  });
  const snapshot: RunSnapshot = {
    id: crypto.randomUUID(),
    revision_id: revision.id,
    revision_number: revision.number,
    workflow_name: revision.name,
    workflow: revision.workflow,
    status: "paused",
    execution_pending: false,
    created_at,
    compiler_version: "research-0.3.0",
    checkpoint_id: "synthetic-checkpoint",
    brief: "Inspect the saved tests.",
    artifacts: [],
    reviews: [
      {
        interrupt_id: "synthetic-review",
        node_id: "judgment",
        path: "root/judgment",
        question: "Which result survives scrutiny?",
      },
    ],
    events: [
      {
        node_id: body.selected,
        path: inIteration(1),
        label: "Model prompt",
        kind: "research",
        detail: "The first comparison passed.",
      },
      {
        node_id: code.selected,
        label: "Custom code",
        kind: "code",
        detail: "Calculation saved.",
        code: {
          runtime: "quickjs-ng-0.18.0.1",
          source_sha256: "8".repeat(64),
          duration_ms: 2,
          inputs: { brief: "", text: "", number: 0, iteration: 1, artifact_count: 0 },
          outputs: { text: "Synthetic spread calculation", number: 0 },
        },
      },
      {
        node_id: note.selected,
        label: "Research note",
        kind: "note",
        detail: "Check the denominator.",
      },
    ],
    model_attempts: [
      attempt(inIteration(1), "Preliminary view.", "Check the source date."),
      attempt(
        `${inIteration(1)}/analyst-pass-2`,
        `The first comparison passed. ${"Retained observations. ".repeat(20)}Original window verified.`,
      ),
      attempt(
        inIteration(2),
        "The second comparison needs a wider window.",
        "Extend the baseline.",
      ),
    ],
  };
  await page.route(`**/api/runs/${snapshot.id}`, (route) => route.fulfill({ json: snapshot }));
  await page.route(`**/api/revisions/${revision.id}`, (route) => route.fulfill({ json: revision }));
  await page.setViewportSize({ width: 390, height: 950 });
  await page.goto(`/?run=${snapshot.id}&view=runs`);
  const feedback = page.getByRole("textbox", { name: "Reviewer feedback", exact: true });
  await feedback.fill("Check the original window before continuing.");
  const outputs = page.getByRole("button", { name: "Outputs", exact: true });
  await outputs.click();
  const index = page.getByRole("region", { name: "Saved step outputs" });
  const items = index.getByRole("listitem");
  await expect(items).toHaveCount(4);
  await expect(items.filter({ hasText: "Iteration 1" })).toContainText("Pass 2 · Conclusion");
  await expect(items.filter({ hasText: "Iteration 2" })).toContainText("Pass 1 · Research lead");
  await expect(items.filter({ hasText: "Calculation" })).toContainText("Number output: 0");
  await expect(index).toContainText("Check the denominator.");
  await page.screenshot({ path: info.outputPath("outputs-mobile.png"), fullPage: true });
  const search = index.getByRole("searchbox", { name: "Find an output" });
  const type = index.getByRole("combobox", { name: "Output type" });
  await type.selectOption("research");
  await search.fill("Original window verified");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("Original window verified.");
  await items
    .first()
    .getByRole("button", { name: /Iteration 1/ })
    .press("Enter");
  const step = page.getByRole("region", { name: "Selected step" });
  await expect(step.locator(".research-attempt[open] > summary")).toContainText("Pass 2");
  await expect(page.getByRole("combobox", { name: "Inspect step" })).toHaveValue(inIteration(1));
  await expect(page.getByRole("group", { name: "Latest workflow activity" })).toContainText(
    "Waiting for review",
  );
  await outputs.click();
  await expect(search).toHaveValue("Original window verified");
  await expect(type).toHaveValue("research");
  await type.selectOption("code");
  await expect(index.getByRole("status")).toHaveText("No outputs match these filters.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Return to review", exact: true }).click();
  await expect(feedback).toHaveValue("Check the original window before continuing.");
});
