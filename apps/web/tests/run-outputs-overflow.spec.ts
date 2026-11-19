import { expect, test } from "./fixtures";
import { exampleWorkflow, type RunSnapshot, type WorkflowRevision } from "../src/lib/workflow";
import { addTemplate } from "../src/lib/workflow-editing";

test("large output indexes search beyond the rows currently displayed", async ({ page }) => {
  let workflow = structuredClone(exampleWorkflow);
  let previous = workflow.start_node;
  const events: RunSnapshot["events"] = [];
  for (let number = 1; number <= 43; number++) {
    const added = addTemplate(workflow, null, "note", previous);
    workflow = added.workflow;
    previous = added.selected;
    const label = `Recorded note ${number}`;
    workflow.nodes.find((node) => node.id === previous)!.label = label;
    const detail = number === 1 ? "Prior note found through search." : "Saved observation.";
    events.push({ node_id: previous, kind: "note", label, detail });
  }
  const created_at = "2026-11-19T15:00:00Z";
  const revision: WorkflowRevision = {
    id: crypto.randomUUID(),
    name: workflow.name,
    number: 1,
    content_hash: "0123456789abcdef",
    created_at,
    workflow,
  };
  const run: RunSnapshot = {
    id: crypto.randomUUID(),
    revision_id: revision.id,
    revision_number: revision.number,
    workflow_name: revision.name,
    workflow,
    status: "completed",
    execution_pending: false,
    created_at,
    compiler_version: "graph-0.2.0",
    checkpoint_id: null,
    brief: "Review a long recording.",
    artifacts: [],
    events,
  };
  await page.route(`**/api/runs/${run.id}`, (route) => route.fulfill({ json: run }));
  await page.route(`**/api/revisions/${revision.id}`, (route) => route.fulfill({ json: revision }));
  await page.goto(`/?run=${run.id}&view=runs`);
  const outputs = page.getByRole("button", { name: "Outputs", exact: true });
  await outputs.click();
  const index = page.getByRole("region", { name: "Saved step outputs" });
  const items = index.getByRole("listitem");
  const first = index.getByRole("button", { name: "Recorded note 1", exact: true });
  const search = index.getByRole("searchbox", { name: "Find an output" });
  await expect(items).toHaveCount(40);
  await expect(index.getByRole("status")).toHaveText("Showing 40 of 43 outputs");
  await expect(first).toHaveCount(0);
  await search.fill("Prior note found");
  await expect(items).toHaveCount(1);
  await expect(first).toBeVisible();
  await search.clear();
  await index.getByRole("button", { name: "Show more outputs" }).click();
  await expect(items).toHaveCount(43);
  await first.click();
  await expect(page.getByRole("region", { name: "Selected step" })).toContainText(
    "Prior note found through search.",
  );
  await outputs.click();
  await expect(items).toHaveCount(43);
  const type = index.getByRole("combobox", { name: "Output type" });
  await type.selectOption("research");
  await type.selectOption("");
  await expect(items).toHaveCount(40);
});
