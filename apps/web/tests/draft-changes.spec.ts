import { expect, test } from "./fixtures";
import example from "../../../examples/research-workflow.json";
import advanced from "../../../examples/advanced-workflow.json";
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
  await instructions.fill("What observation could reverse the provisional view?");
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
  await expect(instructions).toHaveValue("What observation could reverse the provisional view?");
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
