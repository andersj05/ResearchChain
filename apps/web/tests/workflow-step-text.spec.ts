import { expect, test } from "./fixtures";
import macro from "../../../examples/discretionary-macro.json";

for (const { width, stepId, field } of [
  { width: 1440, stepId: "map", field: "Instructions" },
  { width: 390, stepId: "mandate", field: "Review question" },
]) {
  test(`expand and apply ${field.toLowerCase()} as one Build edit at ${width}px`, async ({
    page,
    request,
  }) => {
    const saved = await request.post("/api/revisions", { data: macro });
    expect(saved.ok(), await saved.text()).toBe(true);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/?revision=${(await saved.json()).id}&view=workflow`);
    const step = macro.nodes.find((node) => node.id === stepId)!;
    const steps = page.locator("#step-library .node-outline");
    await steps.getByRole("button", { name: new RegExp(step.label) }).click();
    const inspector = page.getByRole("group", { name: "Node inspector" });
    const inline = inspector.getByRole("textbox", { name: field, exact: true });
    const expand = inspector.getByRole("button", {
      name: `Expand ${field.toLowerCase()}`,
      exact: true,
    });
    const dialog = page.getByRole("dialog", { name: `Edit ${field.toLowerCase()}`, exact: true });
    const editor = dialog.getByRole("textbox", { name: field, exact: true });
    const apply = dialog.getByRole("button", { name: "Apply to draft", exact: true });
    const undo = page.getByRole("button", { name: "Undo last edit", exact: true });
    await expect(inline).toHaveValue(step.instructions!);
    await expect(undo).toBeDisabled();
    const inlineBox = (await inline.boundingBox())!;

    await expand.click();
    await expect(dialog).toHaveAccessibleDescription(step.label);
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue(step.instructions!);
    await expect(apply).toBeDisabled();
    const editorBox = (await editor.boundingBox())!;
    expect(editorBox.height).toBeGreaterThan(inlineBox.height * 2);
    if (width > 850) expect(editorBox.width).toBeGreaterThan(inlineBox.width * 2);
    await editor.fill("Discard this temporary edit.");
    await editor.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(expand).toBeFocused();
    await expect(inline).toHaveValue(step.instructions!);
    await expect(undo).toBeDisabled();

    const edited = `${step.instructions}\n\nCompare the five sessions after the release.`;
    await expand.press("Enter");
    await editor.fill(edited);
    await apply.click();
    await expect(dialog).toBeHidden();
    await expect(expand).toBeFocused();
    await expect(inline).toHaveValue(edited);
    await undo.click();
    await expect(inline).toHaveValue(step.instructions!);
    await expect(undo).toBeDisabled();
  });
}
