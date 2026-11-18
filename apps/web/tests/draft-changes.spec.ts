import { expect, test } from "./fixtures";
import example from "../../../examples/research-workflow.json";
import { compareWorkflowDraft } from "../src/lib/workflow-draft-comparison";
import type { AgentDetail, Workflow } from "../src/lib/workflow";

test("Build previews draft changes and distinguishes reverted edits from layout changes", async ({
  page,
  request,
}) => {
  const saved = await request.post("/api/revisions", { data: example });
  expect(saved.status()).toBe(201);
  const revision = await saved.json();
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.goto(`/?revision=${revision.id}&view=workflow`);
  await expect(page.getByRole("button", { name: "Save revision" })).toBeEnabled();

  const preview = page.getByRole("button", { name: "Draft changes", exact: true });
  const dialog = page.getByRole("dialog", { name: "Draft changes" });
  const writes: string[] = [];
  page.on("request", (entry) => {
    if (entry.method() === "POST") writes.push(new URL(entry.url()).pathname);
  });
  await expect(preview).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Instructions", exact: true })
    .fill("Test a rival signal.");
  await page.getByText("Execution limits", { exact: true }).click();
  await page.getByRole("spinbutton", { name: "Maximum step executions" }).fill("100");
  await preview.click();
  await expect(dialog.getByText(`Compared with saved revision ${revision.number}.`)).toBeVisible();
  await expect(dialog.getByText("Maximum step executions", { exact: true })).toBeVisible();
  await expect(dialog.getByText("256", { exact: true })).toBeVisible();
  await expect(dialog.getByText("100", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Frame the question · Changed")).toBeVisible();
  await expect(dialog.getByText(example.nodes[0]!.instructions, { exact: true })).toBeVisible();
  await expect(dialog.getByText("Test a rival signal.", { exact: true })).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(dialog.getByText("100", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 880 });
  expect(await dialog.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.keyboard.press("Escape");
  await expect(preview).toBeFocused();
  await expect(dialog).toBeHidden();

  const undo = page.getByRole("button", { name: "Undo last edit", exact: true });
  await undo.click();
  await undo.click();
  await preview.click();
  await expect(dialog.getByText("The draft matches the saved revision.")).toBeVisible();
  await dialog.getByRole("button", { name: "Close draft changes" }).click();

  await page.getByRole("button", { name: "Reset view", exact: true }).click();
  const node = page.getByRole("button", { name: "Edit Frame the question", exact: true });
  const position = (await node.boundingBox())!;
  await page.mouse.move(position.x + 80, position.y + 40);
  await page.mouse.down();
  await page.mouse.move(position.x + 110, position.y + 60, { steps: 6 });
  await page.mouse.up();
  await preview.click();
  await expect(dialog.getByText("Only canvas positions changed.")).toBeVisible();
  expect(writes).toEqual([]);
});

test("draft changes separate unknown document edits from canvas positions", () => {
  const values = example as Workflow;
  const saved: Workflow = {
    ...values,
    schema_version: "0.2",
    subgraphs: [
      {
        id: "unused",
        version: 1,
        name: "Unused definition",
        start_node: values.start_node,
        nodes: structuredClone(values.nodes),
        edges: values.edges,
      },
    ],
  };
  const draft = structuredClone(saved);
  draft.subgraphs![0]!.nodes[0]!.position.x += 25;
  expect(compareWorkflowDraft(saved, draft).kind).toBe("layout");
  draft.subgraphs![0]!.nodes[0]!.instructions = "Compare a different input.";
  expect(compareWorkflowDraft(saved, draft).kind).toBe("other");
});

test("compare the draft with an earlier agent version and ignore stale responses", async ({
  page,
  request,
}) => {
  const firstWorkflow = structuredClone(example);
  firstWorkflow.name = "Comparison agent";
  firstWorkflow.nodes[0]!.instructions = "Original saved instructions";
  const firstResponse = await request.post("/api/agents", {
    data: { id: crypto.randomUUID(), workflow: firstWorkflow },
  });
  expect(firstResponse.status()).toBe(201);
  const first: AgentDetail = await firstResponse.json();
  const currentWorkflow = structuredClone(firstWorkflow);
  currentWorkflow.nodes[0]!.instructions = "Current saved instructions";
  const currentResponse = await request.post(`/api/agents/${first.agent.id}/revisions`, {
    data: { expected_version: 1, workflow: currentWorkflow },
  });
  expect(currentResponse.status()).toBe(201);
  const current: AgentDetail = await currentResponse.json();
  const otherResponse = await request.post("/api/agents", {
    data: { id: crypto.randomUUID(), workflow: { ...example, name: "Other agent" } },
  });
  expect(otherResponse.status()).toBe(201);
  const other: AgentDetail = await otherResponse.json();
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.goto(`/?agent=${first.agent.id}&view=workflow`);

  const instructions = page.getByRole("textbox", { name: "Instructions", exact: true });
  const preview = page.getByRole("button", { name: "Draft changes", exact: true });
  const dialog = page.getByRole("dialog", { name: "Draft changes" });
  const baseline = dialog.getByRole("combobox", { name: "Compare with", exact: true });
  const earlierPath = `/api/revisions/${first.revision.id}`;
  const fail = Promise.withResolvers<void>();
  const stale = Promise.withResolvers<void>();
  let earlierReads = 0;
  await page.route(`**${earlierPath}`, async (route) => {
    earlierReads += 1;
    if (earlierReads === 1) {
      await fail.promise;
      await route.fulfill({ status: 503, json: { detail: "Synthetic read failure" } });
      return;
    }
    if (earlierReads === 3) await stale.promise;
    await route.continue();
  });
  const writes: string[] = [];
  page.on("request", (entry) => {
    if (entry.method() === "POST") writes.push(new URL(entry.url()).pathname);
  });

  try {
    await expect(instructions).toHaveValue("Current saved instructions");
    await instructions.fill("My edited instructions");
    const location = page.url();
    await preview.click();
    await expect(baseline).toHaveValue(current.revision.id);
    await expect(baseline.locator("option")).toHaveText([
      `Current saved revision ${current.revision.number}`,
      `Version 1 · Revision ${first.revision.number}`,
    ]);
    await expect(dialog.getByText("Current saved instructions", { exact: true })).toBeVisible();
    expect(earlierReads).toBe(0);

    await baseline.selectOption(first.revision.id);
    await expect(dialog.getByRole("status")).toHaveText("Loading saved revision…");
    fail.resolve();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Could not load the selected saved revision.",
    );
    await dialog.getByRole("button", { name: "Retry comparison", exact: true }).click();
    await expect(dialog.getByText("Original saved instructions", { exact: true })).toBeVisible();
    await expect(dialog.getByText("My edited instructions", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Current saved instructions", { exact: true })).toHaveCount(0);
    expect(page.url()).toBe(location);

    await page.keyboard.press("Escape");
    await expect(preview).toBeFocused();
    await expect(instructions).toHaveValue("My edited instructions");
    await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
    await expect(instructions).toHaveValue("Current saved instructions");
    await page.getByRole("button", { name: "Redo last edit", exact: true }).click();
    await preview.click();
    await expect(baseline).toHaveValue(current.revision.id);
    const pendingRead = page.waitForRequest(
      (entry) => new URL(entry.url()).pathname === earlierPath,
    );
    await baseline.selectOption(first.revision.id);
    await pendingRead;
    await expect(dialog.getByRole("status")).toHaveText("Loading saved revision…");
    await page.keyboard.press("Escape");
    await page.getByRole("combobox", { name: "Agent", exact: true }).selectOption(other.agent.id);
    await expect(instructions).toHaveValue(example.nodes[0]!.instructions);
    await instructions.fill("Another agent's draft");
    await preview.click();
    await expect(baseline).toHaveCount(0);
    const lateResponse = page.waitForResponse(
      (entry) => new URL(entry.url()).pathname === earlierPath,
    );
    stale.resolve();
    await lateResponse;
    await expect(
      dialog.getByText(`Compared with saved revision ${other.revision.number}.`),
    ).toBeVisible();
    await expect(dialog.getByText("Another agent's draft", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Original saved instructions", { exact: true })).toHaveCount(0);
    expect(earlierReads).toBe(3);
    expect(writes).toEqual([]);
  } finally {
    fail.resolve();
    stale.resolve();
  }
});
