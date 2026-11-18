import { expect, test } from "./fixtures";
import example from "../../../examples/research-workflow.json";
import { compareWorkflowDraft } from "../src/lib/workflow-draft-comparison";
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
