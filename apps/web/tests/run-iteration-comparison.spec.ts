import { createHash } from "node:crypto";
import { expect, test } from "./fixtures";
import { contentUrl } from "../src/lib/evidence";
import {
  discretionaryMacroWorkflow,
  type RunSnapshot,
  type WorkflowRevision,
} from "../src/lib/workflow";
import { addTemplate, referenceOf } from "../src/lib/workflow-editing";

test("compare exact saved passes across one loop coordinate on a phone", async ({ page }, info) => {
  const outer = addTemplate(structuredClone(discretionaryMacroWorkflow), null, "loop", "activity");
  const outerStep = outer.workflow.nodes.find((node) => node.id === outer.selected)!;
  outerStep.label = "Evidence cycle";
  const outerRef = referenceOf(outerStep)!;
  const inner = addTemplate(outer.workflow, outerRef, "loop", "pass");
  const outerBody = inner.workflow.subgraphs!.find((graph) => graph.id === outerRef.id)!;
  const innerStep = outerBody.nodes.find((node) => node.id === inner.selected)!;
  innerStep.label = "Challenge cycle";
  if (innerStep.config?.type === "loop") innerStep.config.max_iterations = 3;
  // The same pinned body may be called by another step with the very same label.
  outerBody.nodes.push({ ...innerStep, id: "other_call" });
  const nested = addTemplate(inner.workflow, referenceOf(innerStep)!, "model", "pass");
  const pathFor = (outerNumber: number, innerNumber: number, caller = inner.selected) =>
    `root/${outer.selected}/iteration-${outerNumber}/${caller}/iteration-${innerNumber}/${nested.selected}`;

  const created_at = "2026-11-19T15:00:00Z";
  const revision: WorkflowRevision = {
    id: crypto.randomUUID(),
    name: nested.workflow.name,
    number: 1,
    content_hash: "0123456789abcdef",
    created_at,
    workflow: nested.workflow,
  };
  const requests = new Map<string, string>();
  const attempt = (
    path: string,
    conclusion: string,
    feedback: string,
    source: string,
    next_lead?: string,
  ): NonNullable<RunSnapshot["model_attempts"]>[number] => {
    const packet = JSON.stringify({
      brief: "Compare the curve evidence.",
      additional_context: "",
      human_feedback: feedback,
      sources: [],
    });
    const request = JSON.stringify({
      instructions: "Challenge the transmission mechanism.",
      input: [{ role: "user", content: [{ type: "input_text", text: packet }] }],
    });
    const input_artifact_id = `sha256:${createHash("sha256").update(request).digest("hex")}`;
    requests.set(input_artifact_id, request);
    return {
      id: crypto.randomUUID(),
      path,
      model: "test-model",
      status: "completed",
      stage: "custom",
      input_artifact_id,
      input_bytes: Buffer.byteLength(request),
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
        web_research: {
          version: "web-research-1",
          observed_at: created_at,
          actions: [],
          sources: [
            { url: "https://example.org/policy", title: "Policy release", cited: true },
            { url: `https://example.org/${source}`, title: source, cited: false },
          ],
          truncated: false,
        },
      },
    };
  };
  const lead = attempt(
    pathFor(1, 1),
    "Early view.",
    "Use five sessions.",
    "event-study",
    "Check liquidity.",
  );
  const first = attempt(
    `${pathFor(1, 1)}/analyst-pass-2`,
    "First test conclusion.",
    "Use ten sessions.",
    "spread",
  );
  const second = attempt(
    pathFor(1, 2),
    "Revised test conclusion.",
    "Use twenty sessions.",
    "volume",
  );
  const third = attempt(pathFor(1, 3), "Third test conclusion.", "Use forty sessions.", "price");
  const differentCaller = attempt(
    pathFor(1, 1, "other_call"),
    "Parallel check conclusion.",
    "Check the basis.",
    "basis",
  );
  const differentCycles = attempt(
    pathFor(2, 1),
    "Different parent check.",
    "Check the dollar.",
    "dollar",
  );
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
    brief: "Compare the curve evidence.",
    artifacts: [],
    reviews: [
      { interrupt_id: "synthetic-review", node_id: "judgment", question: "Keep this view?" },
    ],
    events: [],
    model_attempts: [lead, first, second, third, differentCaller, differentCycles],
  };
  for (const [id, body] of requests) {
    await page.route(`**${contentUrl(id)}*`, (route) =>
      route.fulfill({ body, contentType: "application/json" }),
    );
  }
  await page.route(`**/api/runs/${snapshot.id}`, (route) => route.fulfill({ json: snapshot }));
  await page.route(`**/api/revisions/${revision.id}`, (route) => route.fulfill({ json: revision }));
  await page.setViewportSize({ width: 390, height: 950 });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/?run=${snapshot.id}&view=runs`);

  const feedback = page.getByRole("textbox", { name: "Reviewer feedback", exact: true });
  await feedback.fill("Keep the latest conclusion under review.");
  const map = page.getByRole("group", { name: "Run graph view", exact: true });
  await expect(map).toBeVisible();
  await page.getByRole("button", { name: "Outputs", exact: true }).click();
  await expect(map).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Latest workflow activity" })).toContainText(
    "Waiting for review",
  );
  await page.getByRole("button", { name: "Show workflow map", exact: true }).click();
  await expect(map).toBeVisible();
  await page.getByRole("button", { name: "Hide workflow map", exact: true }).click();
  const outputs = page.getByRole("region", { name: "Saved step outputs" });
  const search = outputs.getByRole("searchbox", { name: "Find an output" });
  await search.fill("Revised test conclusion");
  const open = outputs.getByRole("button", { name: /^Compare iterations for/ });
  await open.click();
  const comparison = page.getByRole("region", { name: "Compare saved iterations" });
  const before = comparison.getByRole("combobox", { name: "Earlier iteration", exact: true });
  const after = comparison.getByRole("combobox", { name: "Later iteration", exact: true });
  const earlierOutput = comparison.getByRole("region", { name: "Earlier iteration", exact: true });
  const laterOutput = comparison.getByRole("region", { name: "Later iteration", exact: true });
  await expect(before.getByRole("option")).toHaveCount(1);
  await expect(before).toHaveValue(pathFor(1, 1));
  await expect(after).toHaveValue(pathFor(1, 2));
  await expect(earlierOutput).toContainText("First test conclusion.");
  await expect(laterOutput).toContainText("Revised test conclusion.");
  await after.selectOption(pathFor(1, 3));
  await expect(laterOutput).toContainText("Third test conclusion.");
  await after.selectOption(pathFor(1, 2));
  await comparison.getByRole("button", { name: "Back to outputs", exact: true }).click();
  await expect(search).toHaveValue("Revised test conclusion");
  await open.click();

  const savedPass = earlierOutput.getByRole("combobox", { name: "Saved pass", exact: true });
  await savedPass.selectOption(lead.id);
  await expect(earlierOutput).toContainText("Early view.");
  await expect(earlierOutput).toContainText("Check liquidity.");
  await comparison.getByText("Recorded web sources · 1 shared", { exact: true }).click();
  await expect(
    comparison.getByRole("region", { name: "Earlier iteration web sources" }),
  ).toContainText("event-study");
  await expect(
    comparison.getByRole("region", { name: "Later iteration web sources" }),
  ).toContainText("volume");
  await comparison.getByText("Saved research input changes", { exact: true }).click();
  await comparison.getByText("Reviewer feedback", { exact: true }).click();
  await expect(comparison.getByRole("region", { name: "Earlier iteration input" })).toContainText(
    "Use five sessions.",
  );
  await expect(comparison.getByRole("region", { name: "Later iteration input" })).toContainText(
    "Use twenty sessions.",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: info.outputPath("iteration-comparison-mobile.png"),
    fullPage: true,
  });
  await comparison.getByRole("button", { name: "Copy iteration comparison link" }).click();
  await expect(comparison.getByText("Iteration comparison link copied.")).toBeVisible();
  const bookmark = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  expect(bookmark.searchParams.get("iterations")).toBe(`${lead.id},${second.id}`);
  await page.goto(bookmark.href);
  await expect(savedPass).toHaveValue(lead.id);
  await expect(laterOutput).toContainText("Revised test conclusion.");
  await page.getByRole("button", { name: "Return to review", exact: true }).click();
  await expect(feedback).toHaveValue("Keep the latest conclusion under review.");
  await expect(map).toBeVisible();

  bookmark.searchParams.set("iterations", `${differentCycles.id},${second.id}`);
  await page.goto(bookmark.href);
  await expect(page.getByText("This saved iteration comparison is unavailable.")).toBeVisible();
  await expect(outputs).toBeVisible();
});
