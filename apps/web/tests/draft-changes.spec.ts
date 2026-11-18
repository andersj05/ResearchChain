import { expect, test } from "./fixtures";
import example from "../../../examples/research-workflow.json";
import advanced from "../../../examples/advanced-workflow.json";
import { compareWorkflowGraphs } from "../src/lib/workflow-comparison";
import { compareWorkflowDraft } from "../src/lib/workflow-draft-comparison";
import { addTemplate } from "../src/lib/workflow-editing";
import type { Workflow } from "../src/lib/workflow";

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
