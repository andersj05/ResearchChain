import { expect, test } from "./fixtures";
import {
  discretionaryMacroWorkflow,
  type RunSnapshot,
  type WorkflowRevision,
} from "../src/lib/workflow";
import { addTemplate, graphAt, insertStep, referenceOf } from "../src/lib/workflow-editing";

test("trace carried values to the exact previous nested iteration", async ({ page }) => {
  const outer = addTemplate(structuredClone(discretionaryMacroWorkflow), null, "loop", "test");
  const outerRef = referenceOf(outer.workflow.nodes.find((node) => node.id === outer.selected)!)!;
  const inner = addTemplate(outer.workflow, outerRef, "loop", "step");
  const outerBody = graphAt(inner.workflow, outerRef)!;
  const innerNode = outerBody.nodes.find((node) => node.id === inner.selected)!;
  innerNode.label = "Evidence cycle";
  if (innerNode.config?.type !== "loop") throw new Error("Expected a loop step.");
  innerNode.config.max_iterations = 3;
  Object.assign(outerBody, insertStep(outerBody, { ...innerNode, id: "other_call" }, innerNode.id));
  const innerRef = referenceOf(innerNode)!;
  const source = addTemplate(inner.workflow, innerRef, "model", "step");
  const code = addTemplate(source.workflow, innerRef, "code", source.selected);
  const consumer = addTemplate(code.workflow, innerRef, "model", code.selected);
  const review = addTemplate(consumer.workflow, innerRef, "review", consumer.selected);
  const workflow = review.workflow;
  const body = graphAt(workflow, innerRef)!;
  const sourceNode = body.nodes.find((node) => node.id === source.selected)!;
  sourceNode.label = "Saved evidence";
  if (sourceNode.config?.type !== "research") throw new Error("Expected a model step.");
  sourceNode.config.analyst = { max_passes: 2, skill: "", workspace: false };
  const codeNode = body.nodes.find((node) => node.id === code.selected)!;
  codeNode.label = "Update evidence score";
  if (codeNode.config?.type !== "code") throw new Error("Expected a code step.");
  codeNode.config.source =
    'return { text: "Retained four observations.", number: inputs.number + 4 };';
  codeNode.inputs = {
    number: { source: "previous_iteration", node_id: code.selected, port: "number" },
  };
  const consumerNode = body.nodes.find((node) => node.id === consumer.selected)!;
  consumerNode.label = "Refine the brief";
  consumerNode.inputs = {
    context: { source: "previous_iteration", node_id: source.selected, port: "text" },
    feedback: { source: "previous_iteration", node_id: review.selected, port: "feedback" },
  };
  const caller = `root/${outer.selected}/iteration-2/${inner.selected}`;
  const at = (iteration: number, step: string) => `${caller}/iteration-${iteration}/${step}`;
  const sameSourceDifferentOuter = `root/${outer.selected}/iteration-1/${inner.selected}/iteration-1/${source.selected}`;
  const sameSourceDifferentCaller = `root/${outer.selected}/iteration-2/other_call/iteration-1/${source.selected}`;
  const created_at = "2026-11-19T15:00:00Z";
  const revision: WorkflowRevision = {
    id: crypto.randomUUID(),
    name: workflow.name,
    number: 1,
    content_hash: "0123456789abcdef",
    created_at,
    workflow,
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
      limitations: [],
      evidence_requests: [],
      unresolved_questions: [],
      revision_summary: "",
    },
  });
  const exactConclusion = "Saved conclusion from the selected caller and outer iteration.";
  const sourceEvent = (path: string): RunSnapshot["events"][number] => ({
    node_id: source.selected,
    path,
    kind: "research",
    label: sourceNode.label,
    detail: "Validated research result saved for review.",
  });
  const checkPath = `${caller}/check-1`;
  const run: RunSnapshot = {
    id: crypto.randomUUID(),
    revision_id: revision.id,
    revision_number: revision.number,
    workflow_name: workflow.name,
    workflow,
    status: "paused",
    execution_pending: false,
    created_at,
    compiler_version: "research-0.3.0",
    checkpoint_id: "synthetic-checkpoint",
    brief: "Trace all inputs to their saved run occurrences.",
    artifacts: [],
    reviews: [
      {
        interrupt_id: "synthetic-review",
        node_id: review.selected,
        path: at(2, review.selected),
        question: "Does this result survive scrutiny?",
      },
    ],
    events: [
      sourceEvent(sameSourceDifferentOuter),
      sourceEvent(sameSourceDifferentCaller),
      sourceEvent(at(1, source.selected)),
      {
        node_id: code.selected,
        label: codeNode.label,
        path: at(1, code.selected),
        kind: "code",
        detail: "Score saved.",
        code: {
          runtime: "quickjs-ng-0.18.0.1",
          source_sha256: "8".repeat(64),
          duration_ms: 2,
          inputs: { brief: "", text: "", number: 0, iteration: 1, artifact_count: 0 },
          outputs: { text: "Retained four observations.", number: 4 },
        },
      },
      {
        node_id: review.selected,
        path: at(1, review.selected),
        label: "Earlier evidence review",
        kind: "review",
        detail: "Approved by reviewer",
        review_response: { decision: "approve", feedback: "Recheck the observation window." },
      },
      {
        node_id: inner.selected,
        path: checkPath,
        kind: "loop",
        label: innerNode.label,
        detail: "Iteration 1 completed.",
      },
    ],
    model_attempts: [
      attempt(sameSourceDifferentOuter, "Earlier outer loop."),
      attempt(sameSourceDifferentCaller, "An identical body reached by a second caller."),
      attempt(at(1, source.selected), "Preliminary view.", "Check the observation dates."),
      attempt(`${at(1, source.selected)}/analyst-pass-2`, exactConclusion),
      attempt(at(1, consumer.selected), "The first pass starts with the seed value."),
      attempt(at(2, consumer.selected), "The second pass carries forward the prior evidence."),
    ],
  };
  let includePreviousCompletion = true;
  await page.route(`**/api/runs/${run.id}`, (route) =>
    route.fulfill({
      json: includePreviousCompletion
        ? run
        : { ...run, events: run.events.filter((event) => event.path !== checkPath) },
    }),
  );
  await page.route(`**/api/revisions/${revision.id}`, (route) => route.fulfill({ json: revision }));
  await page.setViewportSize({ width: 390, height: 950 });
  await page.goto(`/?run=${run.id}&view=runs`);
  const feedback = page.getByRole("textbox", { name: "Reviewer feedback", exact: true });
  await feedback.fill("Keep the pinned inputs in view.");
  await expect(
    page.getByText("If the loop continues, feedback goes to Refine the brief in iteration 3.", {
      exact: true,
    }),
  ).toBeVisible();
  const picker = page.getByRole("combobox", { name: "Inspect step", exact: true });
  await page.getByRole("button", { name: "Decisions (1)", exact: true }).click();
  const recorded = page.getByRole("region", { name: "Recorded decisions" });
  await recorded.getByText("Steps wired to this feedback (1)", { exact: true }).click();
  await recorded
    .getByRole("button", { name: "Refine the brief · Iteration 2", exact: true })
    .click();
  await expect(picker).toHaveValue(at(2, consumer.selected));
  const panel = page.getByRole("region", { name: "Selected step" });
  await panel.getByText("Data bindings", { exact: true }).click();
  const inputs = panel.getByRole("region", { name: "Connected inputs" });
  await inputs.getByRole("button", { name: "Saved evidence · text · Iteration 1" }).press("Enter");
  await expect(picker).toHaveValue(at(1, source.selected));
  await expect(panel.locator(".research-attempt[open]")).toContainText(exactConclusion);
  await expect(panel.locator(".research-attempt[open] > summary")).toContainText("Pass 2");

  const next = panel.getByRole("region", { name: "Next iteration bindings" });
  await next.getByRole("button", { name: "Refine the brief · context · Iteration 2" }).click();
  await expect(picker).toHaveValue(at(2, consumer.selected));
  await picker.selectOption(at(2, code.selected));
  await inputs
    .getByRole("button", { name: "Update evidence score · number · Iteration 1" })
    .click();
  await expect(picker).toHaveValue(at(1, code.selected));
  await expect(inputs).toContainText("Initial value in iteration 1 (0)");
  await picker.selectOption(at(1, consumer.selected));
  await expect(inputs).toContainText("Initial value in iteration 1 (empty text)");
  await expect(inputs.getByRole("button", { name: /Saved evidence/ })).toHaveCount(0);

  includePreviousCompletion = false;
  await page.getByRole("button", { name: "Refresh run", exact: true }).click();
  await page.getByRole("button", { name: "Return to review", exact: true }).click();
  await expect(feedback).toHaveValue("Keep the pinned inputs in view.");
  await picker.selectOption(at(2, consumer.selected));
  const disclosure = panel.getByText("Data bindings", { exact: true });
  if (!(await inputs.isVisible())) await disclosure.click();
  await expect(inputs).toContainText(
    "Saved evidence · text · Iteration 1 (saved output unavailable)",
  );
  await expect(inputs.getByRole("button", { name: /Saved evidence/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
