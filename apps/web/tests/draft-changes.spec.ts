import { expect, test } from "./fixtures";
import example from "../../../examples/research-workflow.json";
import advanced from "../../../examples/advanced-workflow.json";
import { compareWorkflowGraphs } from "../src/lib/workflow-comparison";
import {
  applyDraftTextRestoration,
  compareWorkflowDraft,
  draftTextRestoration,
} from "../src/lib/workflow-draft-comparison";
import { addTemplate } from "../src/lib/workflow-editing";
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
  await expect(preview).toBeFocused();

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

test("open changed and added draft steps at their exact root or pinned editor", async ({
  page,
  request,
}) => {
  const nested = addTemplate(
    structuredClone(advanced) as Workflow,
    { id: "critique", version: 1 },
    "note",
    "review",
  );
  nested.workflow.subgraphs![0]!.nodes.find((node) => node.id === nested.selected)!.label =
    "Archived method note";
  const root = addTemplate(nested.workflow, null, "note", "review_loop");
  root.workflow.nodes.find((node) => node.id === root.selected)!.label = "Retire old risk check";
  const saved = await request.post("/api/revisions", { data: root.workflow });
  expect(saved.ok(), await saved.text()).toBe(true);
  const revision = await saved.json();
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.goto(`/?revision=${revision.id}&view=workflow`);
  const writes: string[] = [];
  page.on("request", (entry) => {
    if (entry.method() === "POST") writes.push(new URL(entry.url()).pathname);
  });

  const outline = page.locator(".node-outline");
  const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
  const instructions = page.getByRole("textbox", { name: "Instructions", exact: true });
  const question = page.getByRole("textbox", { name: "Review question", exact: true });
  const remove = page.getByRole("button", { name: "Remove step", exact: true });
  const crumbs = page.getByRole("navigation", { name: "Graph breadcrumbs" });
  await outline.getByRole("button", { name: "Support Note", exact: true }).click();
  await instructions.fill("Use comparable evidence windows for the pricing signal.");
  await page.getByRole("button", { name: "Add research note", exact: true }).click();
  await stepName.fill("Record risk sensitivities");
  await outline.getByRole("button", { name: /Retire old risk check/ }).click();
  await remove.click();
  await outline.getByRole("button", { name: /Review_Loop/ }).click();
  await page.getByRole("button", { name: "New version", exact: true }).click();
  const editBody = page.getByRole("button", { name: "Edit subgraph", exact: true });
  await editBody.click();
  await expect(crumbs).toContainText("Critique and review v2");
  await question.fill("What observation could reverse the provisional view?");
  await outline.getByRole("button", { name: /Archived method note/ }).click();
  await remove.click();
  await crumbs.getByRole("button", { name: "Parallel evidence review", exact: true }).click();
  await expect(stepName).toHaveValue("Review_Loop");

  const preview = page.getByRole("button", { name: "Draft changes", exact: true });
  const dialog = page.getByRole("dialog", { name: "Draft changes" });
  const back = page.getByRole("button", { name: "Return to step Review_Loop", exact: true });
  await preview.press("Enter");
  await expect(dialog).toContainText(`Compared with saved revision ${revision.number}.`);
  await dialog.getByText("Retire old risk check · Removed", { exact: true }).click();
  await dialog.getByText("Archived method note · Removed", { exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: /^Open draft step Retire old risk check/ }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: /^Open draft step Archived method note/ }),
  ).toHaveCount(0);
  await dialog.getByText("Support · Changed", { exact: true }).click();
  await dialog
    .getByRole("button", { name: "Open draft step Support in Main workflow", exact: true })
    .press("Enter");
  await expect(dialog).toBeHidden();
  await expect(stepName).toHaveValue("Support");
  await expect(stepName).toBeFocused();
  await back.press("Enter");
  await expect(stepName).toHaveValue("Review_Loop");

  await preview.click();
  await dialog.getByText("Record risk sensitivities · Added", { exact: true }).click();
  await dialog
    .getByRole("button", {
      name: "Open draft step Record risk sensitivities in Main workflow",
      exact: true,
    })
    .click();
  await expect(dialog).toBeHidden();
  await expect(stepName).toHaveValue("Record risk sensitivities");
  await expect(stepName).toBeFocused();
  await back.click();

  await preview.click();
  await dialog.getByText("Review · Changed", { exact: true }).click();
  await dialog
    .getByRole("button", { name: /^Open draft step Review in Review_Loop/ })
    .press("Enter");
  await expect(dialog).toBeHidden();
  await expect(stepName).toHaveValue("Review");
  await expect(stepName).toBeFocused();
  await expect(crumbs.getByRole("button", { name: "Critique and review v2" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(question).toHaveValue("What observation could reverse the provisional view?");
  await back.press("Enter");
  await expect(stepName).toHaveValue("Review_Loop");
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  await editBody.click();
  await expect(outline.getByRole("button", { name: /Archived method note/ })).toBeVisible();
  const baseline = await (await request.get(`/api/revisions/${revision.id}`)).json();
  expect(baseline.workflow).toEqual(revision.workflow);
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

test("saved text requires a unique matching editable step and an unchanged destination", () => {
  const saved = structuredClone(advanced) as Workflow;
  const draft = structuredClone(saved);
  const body = draft.subgraphs![0]!;
  const review = body.nodes.find((step) => step.id === "review")!;
  const ref = { id: body.id, version: body.version };
  review.instructions = "Draft review question";
  const restoration = draftTextRestoration(saved, ref, body, review.id);
  expect(restoration).toBeDefined();
  expect(applyDraftTextRestoration(structuredClone(draft), restoration!)).toBeUndefined();
  const updated = applyDraftTextRestoration(draft, restoration!);
  expect(updated?.nodes).toBe(draft.nodes);
  expect(updated?.subgraphs?.[0]?.nodes.find((step) => step.id === review.id)).toEqual({
    ...review,
    instructions: restoration!.savedText,
  });
  expect(
    draftTextRestoration(saved, ref, { ...body, nodes: [...body.nodes, review] }, review.id),
  ).toBeUndefined();
  const ambiguous = { ...saved, subgraphs: [...saved.subgraphs!, saved.subgraphs![0]!] };
  expect(draftTextRestoration(ambiguous, ref, body, review.id)).toBeUndefined();
  expect(draftTextRestoration(saved, ref, body, "missing")).toBeUndefined();
  review.kind = "note";
  expect(draftTextRestoration(saved, ref, body, review.id)).toBeUndefined();
});

test("restore saved step text from an earlier comparison without replacing a pinned draft body", async ({
  page,
  request,
}) => {
  const earlier = structuredClone(advanced) as Workflow;
  earlier.name = "Selective restore agent";
  earlier.nodes.find((step) => step.id === "support")!.instructions = "Prior support instructions";
  earlier.subgraphs![0]!.nodes.find((step) => step.id === "review")!.instructions = "";
  const initial = await request.post("/api/agents", {
    data: { id: crypto.randomUUID(), workflow: earlier },
  });
  expect(initial.status()).toBe(201);
  const first: AgentDetail = await initial.json();
  const latest = structuredClone(earlier);
  latest.nodes.find((step) => step.id === "support")!.instructions = "Latest support instructions";
  const body = structuredClone(latest.subgraphs![0]!);
  body.version = 2;
  body.nodes.find((step) => step.id === "review")!.instructions = "Latest saved review question";
  latest.subgraphs!.push(body);
  const owner = latest.nodes.find((step) => step.id === "review_loop")!;
  if (owner.config?.type !== "loop") throw new Error("Expected a pinned loop.");
  owner.config.ref.version = 2;
  const saved = await request.post(`/api/agents/${first.agent.id}/revisions`, {
    data: { expected_version: 1, workflow: latest },
  });
  expect(saved.status()).toBe(201);
  const current: AgentDetail = await saved.json();
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.goto(`/?agent=${first.agent.id}&view=workflow`);

  const outline = page.locator(".node-outline");
  const support = outline.getByRole("button", { name: "Support Note", exact: true });
  const instructions = page.getByRole("textbox", { name: "Instructions", exact: true });
  const name = page.getByRole("textbox", { name: "Step name", exact: true });
  const question = page.getByRole("textbox", { name: "Review question", exact: true });
  const crumbs = page.getByRole("navigation", { name: "Graph breadcrumbs" });
  const undo = page.getByRole("button", { name: "Undo last edit", exact: true });
  await support.click();
  await expect(instructions).toHaveValue("Latest support instructions");
  await instructions.fill("Draft support instructions");
  await outline.getByRole("button", { name: /Review_Loop/ }).click();
  await page.getByRole("button", { name: "Edit subgraph", exact: true }).click();
  await expect(question).toHaveValue("Latest saved review question");
  await expect(crumbs).toContainText("Critique and review v2");
  await name.fill("Risk review");
  await question.fill("Draft review question");

  const writes: string[] = [];
  page.on("request", (entry) => {
    if (entry.method() === "POST") writes.push(new URL(entry.url()).pathname);
  });
  const location = page.url();
  const preview = page.getByRole("button", { name: "Draft changes", exact: true });
  const dialog = page.getByRole("dialog", { name: "Draft changes" });
  const baseline = dialog.getByRole("combobox", { name: "Compare with", exact: true });
  const close = dialog.getByRole("button", { name: "Close draft changes", exact: true });
  await preview.click();
  await expect(baseline).toHaveValue(current.revision.id);
  await baseline.selectOption(first.revision.id);
  await dialog.getByText("Support · Changed", { exact: true }).click();
  await dialog.getByRole("button", { name: /^Use saved instructions for Support/ }).press("Enter");
  await expect(close).toBeFocused();
  await expect(baseline).toHaveValue(first.revision.id);
  await expect(dialog.getByText("Restored saved instructions for Support.")).toBeVisible();
  await dialog.getByRole("button", { name: /^Use saved review question for Risk review/ }).click();
  await expect(close).toBeFocused();
  await expect(baseline).toHaveValue(first.revision.id);
  await expect(dialog.getByText("Restored saved review question for Risk review.")).toBeVisible();
  await expect(dialog.getByText("Review question", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Risk review · Changed", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toBeFocused();
  await expect(question).toHaveValue("");
  await expect(question).toHaveAttribute("placeholder", "Continue this workflow?");
  await expect(name).toHaveValue("Risk review");

  await undo.click();
  await expect(question).toHaveValue("Draft review question");
  await expect(name).toHaveValue("Risk review");
  await crumbs.getByRole("button", { name: earlier.name, exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Subgraph version", exact: true })).toHaveValue(
    "critique@2",
  );
  await support.click();
  await expect(instructions).toHaveValue("Prior support instructions");
  await undo.click();
  await expect(instructions).toHaveValue("Draft support instructions");
  expect(page.url()).toBe(location);
  expect(writes).toEqual([]);
});

test("readable draft wiring keeps stable step IDs and the saved-run comparison", () => {
  const { workflow: saved, selected } = addTemplate(
    structuredClone(advanced) as Workflow,
    null,
    "note",
    "split",
  );
  saved.nodes.find((step) => step.id === selected)!.inputs = {
    text: { source: "output", node_id: "support", port: "text" },
  };
  saved.nodes.find((step) => step.id === "challenge")!.label = "Support";
  const renamed = structuredClone(saved);
  renamed.nodes.find((step) => step.id === "support")!.label = "Supporting evidence";
  renamed.nodes.find((step) => step.id === "split")!.label = "Split evidence";
  const renames = compareWorkflowDraft(saved, renamed);
  if (renames.kind !== "settings") throw new Error("Expected step name changes.");
  expect(renames.graphs[0]!.settings).toEqual([]);
  expect(
    renames.graphs[0]!.steps.flatMap((step) => step.settings.map((setting) => setting.name)),
  ).toEqual(["Step name", "Step name"]);

  const draft = structuredClone(saved);
  draft.nodes.find((step) => step.id === selected)!.inputs!.text = {
    source: "output",
    node_id: "challenge",
    port: "text",
  };
  draft.edges.find((edge) => edge.source === "split" && edge.source_port === "support")!.target =
    "challenge";
  draft.start_node = "support";
  const result = compareWorkflowDraft(saved, draft);
  if (result.kind !== "settings") throw new Error("Expected wiring changes.");
  const root = result.graphs[0]!;
  expect(root.settings).toEqual([
    { name: "First step", before: "Split (split)", after: "Support (support)" },
  ]);
  expect(root.steps.find((step) => step.id === "split")!.settings).toEqual([
    { name: "Next · support", before: "Support (support)", after: "Support (challenge)" },
  ]);
  expect(root.steps.find((step) => step.id === selected)!.settings).toEqual([
    {
      name: "Input · text",
      before: "Support (support) · text",
      after: "Support (challenge) · text",
    },
  ]);
  const runSetup = compareWorkflowGraphs(saved, draft)[0]!;
  expect(runSetup.settings).toEqual([{ name: "First step", before: "split", after: "support" }]);
  expect(runSetup.steps.find((step) => step.id === selected)!.settings).toEqual([
    { name: "Input · text", before: "support · text", after: "challenge · text" },
  ]);
});

test("readable draft wiring uses pinned scopes, built-ins, and unresolved IDs", () => {
  const ref = { id: "critique", version: 1 };
  const { workflow: saved, selected } = addTemplate(
    structuredClone(advanced) as Workflow,
    ref,
    "note",
    "review",
  );
  const body = saved.subgraphs![0]!;
  body.nodes.find((step) => step.id === selected)!.inputs = {
    text: { source: "brief" },
  };
  const draft = structuredClone(saved);
  const loop = draft.nodes.find((step) => step.id === "review_loop")!;
  if (loop.config?.type !== "loop") throw new Error("Expected a pinned loop body.");
  const newBody = structuredClone(body);
  newBody.version = 2;
  newBody.nodes.find((step) => step.id === "review")!.label = "Version two reviewer";
  newBody.nodes.find((step) => step.id === selected)!.inputs = {
    text: { source: "output", node_id: "review", port: "decision" },
  };
  loop.config.ref.version = newBody.version;
  draft.subgraphs!.push(newBody);
  const result = compareWorkflowDraft(saved, draft);
  if (result.kind !== "settings") throw new Error("Expected pinned body changes.");
  expect(result.graphs.find((graph) => graph.key === "critique@1/critique@2")?.steps).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: selected,
        settings: [
          {
            name: "Input · text",
            before: "Research brief",
            after: "Version two reviewer (review) · decision",
          },
        ],
      }),
    ]),
  );

  const broken = structuredClone(draft);
  const brokenBody = broken.subgraphs!.find((graph) => graph.version === 2)!;
  brokenBody.nodes.find((step) => step.id === selected)!.inputs!.text = {
    source: "output",
    node_id: "missing",
    port: "decision",
  };
  brokenBody.edges.find((edge) => edge.source === selected)!.target = "missing-finish";
  const unresolved = compareWorkflowDraft(draft, broken);
  if (unresolved.kind !== "settings") throw new Error("Expected unresolved wiring changes.");
  expect(unresolved.graphs[0]!.steps[0]!.settings).toEqual([
    {
      name: "Input · text",
      before: "Version two reviewer (review) · decision",
      after: "missing · decision",
    },
    { name: "Next · next", before: "Done (done)", after: "missing-finish" },
  ]);
});

test("Build previews rewiring between equally named sources", async ({ page, request }) => {
  const { workflow, selected } = addTemplate(
    structuredClone(advanced) as Workflow,
    null,
    "note",
    "split",
  );
  const consumer = workflow.nodes.find((step) => step.id === selected)!;
  consumer.label = "Write the conclusion";
  consumer.inputs = { text: { source: "output", node_id: "support", port: "text" } };
  workflow.nodes.find((step) => step.id === "support")!.label = "Regional signal";
  workflow.nodes.find((step) => step.id === "challenge")!.label = "Regional signal";
  const response = await request.post("/api/revisions", { data: workflow });
  expect(response.status(), await response.text()).toBe(201);
  const revision = await response.json();
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.goto(`/?revision=${revision.id}&view=workflow`);
  await page
    .locator(".node-outline")
    .getByRole("button", { name: /Write the conclusion/ })
    .click();
  await page
    .getByRole("combobox", { name: "Text input", exact: true })
    .selectOption("challenge:text");
  await page.getByRole("button", { name: "Draft changes", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Draft changes" });
  await expect(dialog.getByText("Input · text", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Regional signal (support) · text", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("Regional signal (challenge) · text", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText(`Compared with saved revision ${revision.number}.`)).toBeVisible();
  await expect(page.locator(".save-state")).toHaveText("Unsaved draft");
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
    await expect(dialog).toHaveAccessibleDescription(
      `Compared with saved revision ${first.revision.number}.`,
    );
    await expect(dialog.getByText("My edited instructions", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Current saved instructions", { exact: true })).toHaveCount(0);
    expect(page.url()).toBe(location);

    await dialog
      .getByRole("button", { name: "Open draft step Frame the question in Main workflow" })
      .press("Enter");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toBeFocused();
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
