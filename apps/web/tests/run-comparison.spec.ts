import { expect, test } from "./fixtures";
import {
  discretionaryMacroWorkflow,
  type RunSnapshot,
  type WorkflowRevision,
} from "../src/lib/workflow";

test("compare two saved research runs without switching the open run", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const now = new Date().toISOString();
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
        },
      },
    ],
  };
  const current: RunSnapshot = {
    ...base,
    id: crypto.randomUUID(),
    revision_id: crypto.randomUUID(),
    revision_number: 13,
    brief: "Check whether it survives a month-long window.",
    events: [
      {
        node_id: "judgment",
        kind: "review",
        label: "Weigh the thesis and the dissent",
        detail: "Approved by reviewer",
        review_response: { decision: "approve", feedback: "Check the curve against the dollar." },
      },
    ],
    model_attempts: [],
  };
  const otherAgent = { ...base, id: crypto.randomUUID(), agent_id: crypto.randomUUID() };
  await page.route("**/api/runs", (route) => route.fulfill({ json: [current, base, otherAgent] }));
  for (const run of [current, base]) {
    await page.route(`**/api/runs/${run.id}`, (route) => route.fulfill({ json: run }));
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
  await page.getByText("Compare a recent run", { exact: true }).click();
  const compare = page.getByRole("combobox", { name: "Comparison run", exact: true });
  await expect(compare.locator("option")).toHaveCount(2);
  await compare.selectOption(base.id);
  const table = page.getByRole("table");
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
  await page.getByRole("button", { name: "Hide workflow map", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Show workflow map", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Run workflow graph", exact: true })).toHaveCount(
    0,
  );
});
