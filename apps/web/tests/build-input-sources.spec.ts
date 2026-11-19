import {
  researchDefaults,
  type Graph,
  type Workflow,
  type WorkflowNode,
} from "../src/lib/workflow";
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
  return page
    .locator(".node-outline .outline-row")
    .filter({ has: page.getByText(name, { exact: true }) })
    .click();
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

function iterationInputsWorkflow(shared = false): Workflow {
  const body = branches("route");
  const ref = { id: "scenario_body", version: 1 };
  const receiver: WorkflowNode = {
    ...step("receiver", "code", "Choose the next test", 60),
    config: {
      type: "code",
      language: "javascript",
      runtime: "quickjs-ng-0.18.0.1",
      source: "return { text: inputs.text, number: inputs.number + 1 };",
      timeout_seconds: 1,
    },
  };
  const model: WorkflowNode = {
    ...step("model", "research", "Investigate the next test", 350),
    config: {
      type: "research",
      stage: "custom",
      prompt_version: "custom-1",
      web_search: false,
      sec_financials: false,
    },
  };
  return {
    schema_version: "0.3",
    name: "Research with iteration inputs",
    start_node: "loop",
    research: researchDefaults,
    nodes: [
      {
        ...step("loop", "loop", "Repeat the research", 60),
        config: { type: "loop", ref, max_iterations: 3 },
      },
      ...(shared
        ? [
            {
              ...step("caller", "subgraph", "Run this definition once", 350),
              config: { type: "subgraph" as const, ref },
            },
          ]
        : []),
      step("finish", "finish", "Finish", 650),
    ],
    edges: shared ? [link("loop", "caller"), link("caller", "finish")] : [link("loop", "finish")],
    subgraphs: [
      {
        ...body,
        ...ref,
        start_node: receiver.id,
        nodes: [receiver, model, ...body.nodes, step("review", "review", "Owner review", 2160)],
        edges: [
          link(receiver.id, model.id),
          link(model.id, body.start_node),
          ...body.edges.map((edge) =>
            edge.target === "finish" ? { ...edge, target: "review" } : edge,
          ),
          link("review", "finish"),
        ],
      },
    ],
  };
}

test("wire an exact previous-iteration output to a loop body input", async ({ page, request }) => {
  await openBuild(page, request, iterationInputsWorkflow());
  await selectStep(page, "Repeat the research");
  await page.getByRole("button", { name: "Edit subgraph", exact: true }).click();
  const text = page.getByRole("combobox", { name: "Code text input", exact: true });
  const number = page.getByRole("combobox", { name: "Code number input", exact: true });
  const previousText = outputGroup(text, "Previous iteration outputs");
  await expect(previousText).toContainText(["Synthesize findings · text · previous iteration"]);
  await expect(previousText.filter({ hasText: "Collect support" })).toHaveCount(0);
  await expect(outputGroup(number, "Previous iteration outputs")).toHaveText([
    "Choose the next test · number · previous iteration",
  ]);
  await text.selectOption("previous_iteration:synthesis:text");
  await number.selectOption("previous_iteration:receiver:number");
  await expect(text).toHaveAccessibleDescription("Iteration 1 uses empty text.");
  await expect(number).toHaveAccessibleDescription("Iteration 1 uses 0.");

  await page
    .getByRole("button", { name: "Open source Synthesize findings for Code text input" })
    .click();
  await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(
    "Synthesize findings",
  );
  await page.getByText("Output bindings", { exact: true }).click();
  await page
    .getByRole("button", {
      name: "text → Choose the next test · text · next iteration",
      exact: true,
    })
    .click();
  await expect(text).toBeFocused();
  await expect(text).toHaveValue("previous_iteration:synthesis:text");

  await selectStep(page, "Investigate the next test");
  const feedback = page.getByRole("combobox", { name: "Reviewer feedback", exact: true });
  await expect(outputGroup(feedback, "Previous iteration outputs")).toHaveText([
    "Owner review · feedback · previous iteration",
  ]);
  await feedback.selectOption("previous_iteration:review:feedback");
  await expect(feedback).toHaveAccessibleDescription("Iteration 1 uses empty text.");
  const behavior = page.getByRole("combobox", { name: "Step behavior", exact: true });
  const context = page.getByRole("combobox", { name: "Context input", exact: true });
  await expect(outputGroup(context, "Previous iteration outputs").first()).toBeAttached();
  await behavior.selectOption("challenge");
  await expect(outputGroup(context, "Previous iteration outputs")).toHaveCount(0);
  await behavior.selectOption("custom");

  await page.getByRole("button", { name: "Draft changes", exact: true }).click();
  const changes = page.getByRole("dialog", { name: "Draft changes", exact: true });
  await expect(
    changes.getByText("Previous iteration · Synthesize findings (synthesis) · text", {
      exact: true,
    }),
  ).toBeVisible();
  await changes.getByRole("button", { name: "Close draft changes", exact: true }).click();
  await page.getByRole("button", { name: "Validate workflow", exact: true }).click();
  await expect(page.getByRole("status", { name: "Workspace status" })).toHaveText(
    "Workflow valid. Ready to run.",
  );
});

test("omit previous iteration options from a body shared with a subgraph caller", async ({
  page,
  request,
}) => {
  await openBuild(page, request, iterationInputsWorkflow(true));
  await selectStep(page, "Repeat the research");
  await page.getByRole("button", { name: "Edit subgraph", exact: true }).click();
  const input = page.getByRole("combobox", { name: "Code text input", exact: true });
  await expect(outputGroup(input, "Previous iteration outputs")).toHaveCount(0);
  await expect(outputGroup(input, "Outputs that need different wiring").first()).toBeAttached();
});
