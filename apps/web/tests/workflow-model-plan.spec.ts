import { expect, test } from "./fixtures";
import research from "../../../examples/hypothesis-research.json";
import { addTemplate, referenceOf } from "../src/lib/workflow-editing";
import type { ProviderStatus, Workflow, WorkflowRevision } from "../src/lib/workflow";

const providersPath = "/api/providers/chatgpt";
const unlisted = "Unlisted for this account";

test("model plan identifies unlisted effective models and opens the pinned step for editing", async ({
  page,
  request,
}) => {
  const draft = structuredClone(research) as Workflow;
  draft.research!.model = "retired-default";
  const plan = draft.nodes.find((node) => node.id === "plan")!;
  if (plan.config?.type !== "research") throw new Error("Expected a research step.");
  plan.config.model = "analysis-model";
  const root = addTemplate(draft, null, "subgraph", "challenge");
  const call = root.workflow.nodes.find((node) => node.id === root.selected)!;
  call.label = "Nested evidence pass";
  const nested = addTemplate(root.workflow, referenceOf(call)!, "model", "step");
  const model = nested.workflow.subgraphs![0]!.nodes.find((node) => node.id === nested.selected)!;
  if (model.config?.type !== "research") throw new Error("Expected a nested research step.");
  model.label = "Nested evidence model";
  model.config.model = "retired-override";
  const response = await request.post("/api/revisions", { data: nested.workflow });
  expect(response.status()).toBe(201);
  const revision: WorkflowRevision = await response.json();

  const release = Promise.withResolvers<void>();
  let reads = 0;
  await page.route(`**${providersPath}`, async (route) => {
    reads += 1;
    await release.promise;
    await route.continue();
  });
  const writes: string[] = [];
  page.on("request", (entry) => {
    if (entry.method() === "POST") writes.push(new URL(entry.url()).pathname);
  });
  await page.setViewportSize({ width: 1440, height: 980 });

  try {
    await page.goto(`/?revision=${revision.id}&view=workflow`);
    const disclosure = page.getByText("Model and tool plan", { exact: true });
    const list = page.getByRole("list", { name: "Reachable research steps" });
    const rows = list.getByRole("listitem");
    const affectedOverride = rows.filter({ hasText: "Nested evidence model" });
    const affectedDefault = rows.filter({ hasText: "Challenge evidence" });
    const available = rows.filter({ hasText: "Form hypotheses" });
    const warnings = list.getByText(unlisted, { exact: true });
    await disclosure.click();
    await expect(page.getByText("Checking the model catalog…", { exact: true })).toBeVisible();
    await expect(warnings).toHaveCount(0);
    await expect(affectedOverride).toContainText("retired-override · Step override");
    release.resolve();
    await expect(page.getByText("3 steps use an unlisted model.", { exact: true })).toBeVisible();
    await expect(warnings).toHaveCount(3);
    await expect(affectedDefault).toContainText("retired-default · Workflow default");
    await expect(affectedDefault).toContainText(unlisted);
    await expect(affectedOverride).toContainText(unlisted);
    await expect(available).toContainText("analysis-model · Step override");
    await expect(available.getByText(unlisted, { exact: true })).toHaveCount(0);
    const readsAfterLoading = reads;

    await affectedOverride
      .getByRole("button", { name: /^Edit Nested evidence model in/ })
      .press("Enter");
    await expect(page.getByRole("navigation", { name: "Graph breadcrumbs" })).toContainText(
      "New subgraph v1",
    );
    const stepModel = page.getByRole("combobox", { name: "Step model", exact: true });
    await expect(stepModel).toHaveValue("retired-override");
    await stepModel.selectOption("analysis-model");
    await disclosure.click();
    await expect(affectedOverride.getByText(unlisted, { exact: true })).toHaveCount(0);
    await expect(warnings).toHaveCount(2);
    const workflowModel = page.getByRole("combobox", { name: "Workflow model", exact: true });
    await expect(workflowModel).toHaveValue("retired-default");
    await workflowModel.selectOption("test-model");
    await expect(warnings).toHaveCount(0);
    await expect(affectedDefault).toContainText("test-model · Workflow default");
    await expect(stepModel).toHaveValue("analysis-model");
    expect(reads).toBe(readsAfterLoading);
    expect(writes).toEqual([]);
  } finally {
    release.resolve();
  }
});

for (const { state, overrides, confirmed } of [
  { state: "no connected account", overrides: { accounts: [], models: [] }, confirmed: false },
  {
    state: "a failed catalog",
    overrides: { models: [], error: "Synthetic catalog error" },
    confirmed: false,
  },
  { state: "an omitted model list", overrides: { models: undefined }, confirmed: false },
  { state: "a confirmed empty list", overrides: { models: [] }, confirmed: true },
]) {
  test(`model plan checks availability with ${state}`, async ({ page, request }) => {
    const draft = structuredClone(research) as Workflow;
    draft.research!.model = "configured-model";
    const saved = await request.post("/api/revisions", { data: draft });
    expect(saved.status()).toBe(201);
    const revision: WorkflowRevision = await saved.json();
    const fixture: ProviderStatus = await (await request.get(providersPath)).json();
    await page.route(`**${providersPath}`, (route) =>
      route.fulfill({
        json: { ...fixture, ...overrides },
      }),
    );
    await page.goto(`/?revision=${revision.id}&view=workflow`);
    await page.getByText("Model and tool plan", { exact: true }).click();
    const list = page.getByRole("list", { name: "Reachable research steps" });
    const warnings = list.getByText(unlisted, { exact: true });
    const rows = list.getByRole("listitem");
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText("configured-model · Workflow default");
    const unavailable = page.getByText(
      "Model catalog unavailable. Connect or refresh in Run workflow.",
      { exact: true },
    );
    if (confirmed) {
      await expect(warnings).toHaveCount(3);
      await expect(unavailable).toHaveCount(0);
    } else {
      await expect(unavailable).toBeVisible();
      await expect(warnings).toHaveCount(0);
    }
  });
}
