import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "./fixtures";
import example from "../../../examples/research-workflow.json";
import type { WorkflowRevision } from "../src/lib/workflow";

test.beforeEach(async ({ page, request }) => {
  const saved = await request.post("/api/revisions", { data: example });
  expect(saved.status()).toBe(201);
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.goto(`/?revision=${(await saved.json()).id}`);
  await expect(page.getByRole("button", { name: "Run workflow" })).toBeEnabled();
});

async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
}
async function valid(page: Page) {
  await page.getByRole("button", { name: "Validate workflow", exact: true }).click();
  await expect(page.getByRole("status", { name: "Workspace status" })).toHaveText(
    "Workflow valid. Ready to run.",
  );
}
async function save(page: Page) {
  await page.getByRole("button", { name: "Save revision", exact: true }).click();
  await expect(page.getByRole("status", { name: "Workspace status" })).toHaveText(
    /Revision \d+ saved\./,
  );
  return new URL(page.url()).searchParams.get("revision")!;
}

test("keyboard ports reconnect controls, cancel safely, and expose undo and redo", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Fit workflow to view" }).click();
  const source = page.getByRole("button", {
    name: "Frame the question: output control next",
    exact: true,
  });
  const target = page.getByRole("button", { name: "Human review: input control in", exact: true });
  await source.focus();
  await source.press("Enter");
  await source.press("ArrowRight");
  await source.press("ArrowRight");
  await expect(target).toHaveAttribute("data-connect", "target");
  await source.press("Escape");
  await expect(page.locator('[data-connect="source"]')).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Next step", exact: true })).toHaveValue(
    "challenge",
  );
  await source.press("Enter");
  await source.press("ArrowRight");
  await source.press("ArrowRight");
  await source.press("Enter");
  await expect(page.getByRole("combobox", { name: "Next step", exact: true })).toHaveValue(
    "review",
  );
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Next step", exact: true })).toHaveValue(
    "challenge",
  );
  await page.getByRole("button", { name: "Redo last edit", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Next step", exact: true })).toHaveValue(
    "review",
  );
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  await valid(page);
});

test("pointer wiring distinguishes data and control ports and serializes data bindings", async ({
  page,
  request,
}) => {
  await page.getByRole("button", { name: "Fit workflow to view" }).click();
  const source = page.getByRole("button", {
    name: "Frame the question: output text text",
    exact: true,
  });
  const wrong = page.getByRole("button", {
    name: "Challenge the thesis: input control in",
    exact: true,
  });
  await drag(page, source, wrong);
  await expect(page.getByRole("button", { name: "Undo last edit", exact: true })).toBeDisabled();
  const target = page.getByRole("button", {
    name: "Challenge the thesis: input text text",
    exact: true,
  });
  await drag(page, source, target);
  await page
    .locator(".node-outline")
    .getByRole("button", { name: "Challenge the thesis Note", exact: true })
    .click();
  await expect(page.getByRole("combobox", { name: "Text input", exact: true })).toHaveValue(
    "frame:text",
  );
  // Reconnect an existing control output with the pointer, then restore the valid route.
  await page.getByRole("button", { name: "Fit workflow to view" }).click();
  await drag(
    page,
    page.getByRole("button", { name: "Frame the question: output control next", exact: true }),
    page.getByRole("button", { name: "Human review: input control in", exact: true }),
  );
  await page
    .locator(".node-outline")
    .getByRole("button", { name: "Frame the question Note Start", exact: true })
    .click();
  await expect(page.getByRole("combobox", { name: "Next step", exact: true })).toHaveValue(
    "review",
  );
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Next step", exact: true })).toHaveValue(
    "challenge",
  );
  const id = await save(page);
  const saved: WorkflowRevision = await (await request.get(`/api/revisions/${id}`)).json();
  expect(saved.workflow.schema_version).toBe("0.2");
  expect(saved.workflow.nodes.find((node) => node.id === "challenge")?.inputs?.text).toEqual({
    source: "output",
    node_id: "frame",
    port: "text",
  });
});

test("typing and a full drag are grouped edits with live connection previews", async ({ page }) => {
  const name = page.getByRole("textbox", { name: "Step name", exact: true });
  await name.fill("");
  await name.pressSequentially("A clearer research question", { delay: 20 });
  await name.press("Control+z");
  await expect(name).toHaveValue("Frame the question");
  await name.press("Control+Shift+z");
  await expect(name).toHaveValue("A clearer research question");
  await page.getByRole("button", { name: "Reset view", exact: true }).click();
  const node = page.getByRole("button", { name: "Edit A clearer research question", exact: true });
  const group = page.locator('[data-node-id="frame"]');
  const edge = page.locator(".connection-control").first();
  const before = await edge.getAttribute("d");
  const at = (await node.boundingBox())!;
  await page.mouse.move(at.x + 80, at.y + 40);
  await page.mouse.down();
  await page.mouse.move(at.x + 130, at.y + 70, { steps: 12 });
  await expect(edge).not.toHaveAttribute("d", before!);
  await page.mouse.up();
  await expect(group).toHaveCSS("left", "110px");
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  await expect(group).toHaveCSS("left", "60px");
  await expect(name).toHaveValue("A clearer research question");
  await page.getByRole("button", { name: "Redo last edit", exact: true }).click();
  await expect(group).toHaveCSS("left", "110px");
});

test("templates, nested breadcrumbs, and expandable groups round-trip through a saved revision", async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Add condition", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Condition value source", exact: true })
    .selectOption("brief");
  await page.getByLabel("Condition compare with", { exact: true }).fill("thesis");
  await valid(page);
  await page.getByRole("button", { name: "Add subgraph", exact: true }).click();
  await page.getByRole("button", { name: "Edit subgraph", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Graph breadcrumbs" }).locator("li"),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "Add bounded loop", exact: true }).click();
  await page.getByLabel("Maximum iterations", { exact: true }).fill("3");
  await page.getByRole("combobox", { name: "Stop rule", exact: true }).selectOption("condition");
  await page.getByLabel("Stop condition compare with", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Edit subgraph", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Graph breadcrumbs" }).locator("li"),
  ).toHaveCount(3);
  await page
    .getByLabel("Instructions", { exact: true })
    .fill("Inspect original evidence in the nested body.");
  const id = await save(page);
  const saved: WorkflowRevision = await (await request.get(`/api/revisions/${id}`)).json();
  expect(
    saved.workflow.subgraphs?.some((body) =>
      body.nodes.some(
        (node) => node.instructions === "Inspect original evidence in the nested body.",
      ),
    ),
  ).toBe(true);
  await page
    .getByRole("navigation", { name: "Graph breadcrumbs" })
    .getByRole("button", { name: "Hypothesis review", exact: true })
    .click();
  await page.getByRole("button", { name: "Fit workflow to view" }).click();
  await page.getByRole("button", { name: "Expand New subgraph", exact: true }).click();
  await expect(page.getByLabel("New subgraph preview", { exact: true })).toContainText(
    "New bounded loop",
  );
  await page.screenshot({
    path: testInfo.outputPath("structured-editor-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Collapse New subgraph", exact: true }).click();
  await expect(page.getByLabel("New subgraph preview", { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("structured-editor-mobile.png"),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("branch settings keep typed edges aligned and expose incomplete-draft diagnostics", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add parallel branches", exact: true }).click();
  await page.getByLabel("Branch 1 name", { exact: true }).fill("supporting");
  await page.getByRole("button", { name: "Add branch", exact: true }).click();
  await page.getByLabel("Branch 3 name", { exact: true }).fill("counterevidence");
  await valid(page);
  await page.getByRole("button", { name: "Remove branch 3 and its steps", exact: true }).click();
  await valid(page);
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  await expect(page.getByLabel("Branch 3 name", { exact: true })).toHaveValue("counterevidence");
  await page
    .getByRole("combobox", { name: "Next step (supporting)", exact: true })
    .selectOption("");
  await page.getByRole("button", { name: "Validate workflow", exact: true }).click();
  await expect(page.locator(".workspace-error")).toContainText(
    "must connect each declared control output exactly once",
  );
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  await valid(page);
});

test("validated JSON import preserves failed drafts, round-trips, and supports undo", async ({
  page,
  request,
}) => {
  await page.getByText("Local draft & export", { exact: true }).click();
  const input = page.getByLabel("Import workflow JSON", { exact: true });
  await input.setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("not json"),
  });
  await expect(page.locator(".workspace-error")).toContainText("not valid JSON");
  await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(
    "Frame the question",
  );
  const invalid = structuredClone(example);
  invalid.nodes[0]!.label = "";
  await input.setInputFiles({
    name: "schema-invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(invalid)),
  });
  await expect(page.locator(".workspace-error")).toContainText("nodes.0.label");
  await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(
    "Frame the question",
  );
  const imported = structuredClone(example);
  imported.name = "Imported research process";
  imported.nodes[0]!.label = "Imported question";
  const validated = await (
    await request.post("/api/workflows/validate", { data: imported })
  ).json();
  await input.setInputFiles({
    name: "workflow.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(
    "Imported question",
  );
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const path = await (await downloaded).path();
  expect(JSON.parse(await readFile(path!, "utf8"))).toEqual(validated.workflow);
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(
    "Frame the question",
  );
  await page.getByRole("button", { name: "Redo last edit", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(
    "Imported question",
  );
});

test("new definition versions and nested draft edits keep an existing run pinned", async ({
  page,
  request,
}) => {
  await page.getByRole("button", { name: "Add subgraph", exact: true }).click();
  await page.getByRole("button", { name: "Edit subgraph", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Instructions", exact: true })
    .fill("Original nested instructions.");
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Run paused", exact: true })).toBeVisible();
  const runId = new URL(page.url()).searchParams.get("run");
  await page.getByRole("tab", { name: "Workflow", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Graph breadcrumbs" })
    .getByRole("button", { name: "Hypothesis review", exact: true })
    .click();
  await page.getByRole("button", { name: "New version", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Subgraph version", exact: true }).locator("option:checked"),
  ).toContainText("v2");
  await page.getByRole("button", { name: "Edit subgraph", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Instructions", exact: true })
    .fill("New version instructions.");
  const revisionId = await save(page);
  const revision: WorkflowRevision = await (
    await request.get(`/api/revisions/${revisionId}`)
  ).json();
  expect(
    revision.workflow.subgraphs?.find((body) => body.version === 1)?.nodes[0]?.instructions,
  ).toBe("Original nested instructions.");
  expect(
    revision.workflow.subgraphs?.find((body) => body.version === 2)?.nodes[0]?.instructions,
  ).toBe("New version instructions.");
  await page.getByText("Definitions (2)", { exact: true }).click();
  await page.getByRole("button", { name: "Remove unused definitions", exact: true }).click();
  const prunedId = await save(page);
  const pruned: WorkflowRevision = await (await request.get(`/api/revisions/${prunedId}`)).json();
  expect(pruned.workflow.subgraphs).toHaveLength(1);
  expect(pruned.workflow.subgraphs?.[0]?.version).toBe(2);
  const run = await (await request.get(`/api/runs/${runId}`)).json();
  expect(run.workflow.subgraphs).toHaveLength(1);
  expect(run.workflow.subgraphs[0].nodes[0].instructions).toBe("Original nested instructions.");
  expect(
    run.events.find((event: { path: string }) => event.path.includes("/body/step")).detail,
  ).toContain("Original nested instructions.");
});
