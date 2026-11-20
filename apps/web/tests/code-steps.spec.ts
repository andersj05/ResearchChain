import { expect, test } from "./fixtures";
import type { RunSnapshot } from "../src/lib/workflow";

for (const width of [1440, 390]) {
  test(`owner code transforms data, persists results and reports errors at ${width}px`, async ({
    page,
    request,
  }, info) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/?view=workflow");
    await page.getByRole("button", { name: "New workflow", exact: true }).click();
    await page.getByRole("button", { name: "Add custom code", exact: true }).click();
    await page.getByRole("textbox", { name: "Step name", exact: true }).fill("My transform");
    const editor = page.getByRole("textbox", { name: "Code", exact: true });
    const source = "return { text: inputs.text.toUpperCase(), number: inputs.text.length };";
    await editor.fill(source);
    await page.screenshot({ path: info.outputPath(`code-editor-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Add research note", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Text input", exact: true })
      .selectOption({ label: "My transform · text" });
    await page.getByRole("button", { name: "Run workflow", exact: true }).click();
    await page.getByRole("textbox", { name: "Research brief", exact: true }).fill("Owner code");
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Completed", {
      timeout: 30000,
    });
    const graph = page.getByRole("region", { name: "Run workflow graph" });
    await graph.getByRole("button", { name: "Fit run graph to view" }).click();
    await graph.getByRole("button", { name: "Inspect My transform", exact: true }).click();
    await page.getByText("Code inputs and outputs", { exact: true }).click();
    await expect(page.locator(".code-result")).toContainText("OWNER CODE");
    await expect(page.locator(".code-result")).toContainText(/Number output\s*10/);
    const runId = new URL(page.url()).searchParams.get("run")!;
    const original: RunSnapshot = await (await request.get(`/api/runs/${runId}`)).json();
    expect(original.usage?.model_calls).toBe(0);
    expect(original.events[0]?.code?.outputs).toEqual({ text: "OWNER CODE", number: 10 });
    expect(original.events[1]?.detail).toBe("OWNER CODE");
    await page.reload();
    await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Completed");
    await page.getByRole("button", { name: "Iterate from this run", exact: true }).click();
    await expect(editor).toHaveValue(source);
    await editor.fill('throw new Error("Check your input");');
    await page.getByRole("button", { name: "Run workflow", exact: true }).click();
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Needs attention", {
      timeout: 30000,
    });
    await expect(page.getByRole("region", { name: "Run inspector" })).toContainText(
      "Check your input",
    );
    expect(await (await request.get(`/api/runs/${runId}`)).json()).toMatchObject({
      status: "completed",
      revision_id: original.revision_id,
      events: original.events,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
