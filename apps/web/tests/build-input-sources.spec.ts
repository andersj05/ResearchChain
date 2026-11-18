import type { Graph, Workflow, WorkflowNode } from "../src/lib/workflow";
import { expect, test, type APIRequestContext, type Locator, type Page } from "./fixtures";

function step(id: string, kind: WorkflowNode["kind"], label: string, x: number): WorkflowNode {
  return { id, kind, label, instructions: "", position: { x, y: 100 } };
}

function link(source: string, target: string, source_port = "next") {
  return { source, target, source_port, target_port: "in" };
}

function branches(kind: "route" | "fork"): Graph {
  const condition = {
    left: { source: "brief" as const },
    operator: "contains" as const,
    value: "",
  };
  const split: WorkflowNode = {
    ...step("split", kind, "Set research branches", 350),
    config:
      kind === "route"
        ? { type: "route", join: "join", condition }
        : { type: "fork", join: "join", branches: ["yes", "no"] },
  };
  return {
    name: "Compare research inputs",
    start_node: "common",
    nodes: [
      step("common", "note", "Read the market brief", 60),
      split,
      step("support", "note", "Collect support", 650),
      { ...step("dissent", "note", "Collect dissent", 650), position: { x: 650, y: 320 } },
      step("join", "join", "Join research branches", 950),
      step("synthesis", "note", "Synthesize findings", 1250),
      step("later", "note", "Write the memo", 1550),
      step("finish", "finish", "Finish", 1850),
    ],
    edges: [
      link("common", "split"),
      link("split", "support", kind === "route" ? "true" : "yes"),
      link("split", "dissent", kind === "route" ? "false" : "no"),
      link("support", "join"),
      link("dissent", "join"),
      link("join", "synthesis"),
      link("synthesis", "later"),
      link("later", "finish"),
    ],
  };
}

async function openBuild(page: Page, request: APIRequestContext, workflow: Workflow) {
  const saved = await request.post("/api/revisions", { data: workflow });
  expect(saved.status()).toBe(201);
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(`/?revision=${(await saved.json()).id}`);
}

function selectStep(page: Page, name: string) {
  return page.locator(".node-outline").getByRole("button", { name }).click();
}

function outputGroup(select: Locator, label: string) {
  return select.locator(`optgroup[label="${label}"] option`);
}

for (const kind of ["route", "fork"] as const) {
  test(`group Build sources at a ${kind} join`, async ({ page, request }) => {
    await openBuild(page, request, { ...branches(kind), schema_version: "0.2" });
    await selectStep(page, "Synthesize findings");
    const input = page.getByRole("combobox", { name: "Text input", exact: true });
    const available = outputGroup(input, "Outputs available here");
    const other = outputGroup(input, "Outputs that need different wiring");
    const support = "Collect support · text";
    const dissent = "Collect dissent · text";
    await expect(available).toHaveText([
      "Read the market brief · text",
      ...(kind === "fork" ? [support, dissent] : []),
    ]);
    await expect(other).toHaveText([
      ...(kind === "route" ? [support, dissent] : []),
      "Write the memo · text",
    ]);
    await input.selectOption("support:text");
    await expect(input).toHaveValue("support:text");

    if (kind === "route") {
      await page.getByRole("button", { name: "Validate workflow", exact: true }).click();
      await expect(page.locator(".workspace-error")).toContainText(
        "Output from 'support' is not available on every incoming path.",
      );
      await selectStep(page, "Set research branches");
      await page.getByRole("combobox", { name: "Next step (false)", exact: true }).selectOption("");
      await selectStep(page, "Synthesize findings");
      await expect(input.locator("optgroup")).toHaveCount(0);
      await expect(input).toHaveValue("support:text");
      const undo = page.getByRole("button", { name: "Undo last edit", exact: true });
      await undo.click();
      await expect(other).toHaveText([support, dissent, "Write the memo · text"]);
      await expect(input).toHaveValue("support:text");

      await selectStep(page, "Write the memo");
      await page
        .getByRole("combobox", { name: "Next step", exact: true })
        .selectOption("synthesis");
      await selectStep(page, "Synthesize findings");
      await expect(input.locator("optgroup")).toHaveCount(0);
      await expect(input).toHaveValue("support:text");
      await undo.click();
      await input.selectOption("common:text");
    }
    await page.getByRole("button", { name: "Validate workflow", exact: true }).click();
    await expect(page.getByRole("status", { name: "Workspace status" })).toHaveText(
      "Workflow valid. Ready to run.",
    );
  });
}

test("group loop stop sources by the referenced body's completion", async ({ page, request }) => {
  const ref = { id: "scenario_body", version: 1 };
  await openBuild(page, request, {
    schema_version: "0.2",
    name: "Repeat the scenario review",
    start_node: "parent_note",
    nodes: [
      step("parent_note", "note", "Read original release", 60),
      {
        ...step("loop", "loop", "Repeat scenario", 350),
        config: {
          type: "loop",
          ref,
          max_iterations: 3,
          until: {
            left: { source: "output", node_id: "common", port: "text" },
            operator: "contains",
            value: "ready",
          },
        },
      },
      step("finish", "finish", "Finish", 650),
    ],
    edges: [link("parent_note", "loop"), link("loop", "finish")],
    subgraphs: [{ ...branches("route"), ...ref }],
  });
  await selectStep(page, "Repeat scenario");
  const input = page.getByRole("combobox", { name: "Stop condition value source", exact: true });
  await expect(input).toHaveValue("common:text");
  await expect(outputGroup(input, "Outputs available here")).toHaveText([
    "Read the market brief · text",
    "Synthesize findings · text",
    "Write the memo · text",
  ]);
  await expect(outputGroup(input, "Outputs that need different wiring")).toHaveText([
    "Collect support · text",
    "Collect dissent · text",
  ]);
  await expect(input.locator('option[value="parent_note:text"]')).toHaveCount(0);
});
