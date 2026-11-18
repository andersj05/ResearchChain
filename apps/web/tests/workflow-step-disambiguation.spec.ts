import { expect, test } from "./fixtures";
import type { Graph, Workflow, WorkflowNode } from "../src/lib/workflow";

function chain(name: string, steps: WorkflowNode[]): Graph {
  return {
    name,
    start_node: steps[0]!.id,
    nodes: [...steps, step("finish", "Finish", "finish")].map((node, index) => ({
      ...node,
      position: { x: 40 + (index % 6) * 280, y: 80 + Math.floor(index / 6) * 210 },
    })),
    edges: steps.map(({ id }, index) => ({
      source: id,
      target: steps[index + 1]?.id ?? "finish",
      source_port: "next",
      target_port: "in",
    })),
  };
}

function step(
  id: string,
  label: string,
  kind: WorkflowNode["kind"],
  instructions = "",
  config?: WorkflowNode["config"],
): WorkflowNode {
  return { id, label, kind, instructions, config, position: { x: 40, y: 80 } };
}

test("label ambiguous step matches with stable IDs before and after showing more", async ({
  page,
  request,
}) => {
  const firstId = "assess-risk-under-liquidity-constraints-before-the-event-hedge";
  const lastId = "risk_override";
  const name = "Assess risk";
  const workflow: Workflow = {
    schema_version: "0.2",
    ...chain("Research risk checks", [
      step("risk_summary", name, "note"),
      step(firstId, name, "review", "What is the downside case before the hedge?"),
      ...Array.from({ length: 29 }, (_, index) =>
        step(`checkpoint-${index}`, `Check stage ${index + 1}`, "review"),
      ),
      step(lastId, name, "review", "Which scenario changes the decision?"),
    ]),
  };
  const saved = await request.post("/api/revisions", { data: workflow });
  expect(saved.status(), await saved.text()).toBe(201);
  const revision = await saved.json();
  await page.setViewportSize({ width: 390, height: 950 });
  await page.goto(`/?revision=${revision.id}`);

  const search = page.getByRole("searchbox", { name: "Find a step", exact: true });
  const filter = page.getByRole("combobox", { name: "Filter steps by type", exact: true });
  const results = page.getByRole("list", { name: "Matching steps" });
  const rows = results.getByRole("button");
  await filter.selectOption("review");
  await expect(rows).toHaveCount(30);
  await expect(rows.first().locator("code")).toHaveText(firstId);
  await expect(rows.nth(1).locator("code")).toHaveCount(0);
  await page.getByRole("button", { name: "Show more matches", exact: true }).click();
  await expect(rows).toHaveCount(31);
  await expect(rows.first().locator("code")).toHaveText(firstId);
  await expect(rows.last().locator("code")).toHaveText(lastId);

  await filter.selectOption("all");
  await search.fill(name);
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toHaveAccessibleName("Assess risk Note");
  await expect(rows.first().locator("code")).toHaveCount(0);
  await expect(rows.nth(1).locator("code")).toHaveText(firstId);
  await expect(rows.last().locator("code")).toHaveText(lastId);
  expect(await results.evaluate((list) => list.scrollWidth <= list.clientWidth)).toBe(true);

  await filter.selectOption("review");
  await search.press("Enter");
  const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
  const question = page.getByRole("textbox", { name: "Review question", exact: true });
  await expect(stepName).toBeFocused();
  await expect(question).toHaveValue("What is the downside case before the hedge?");
  await rows.filter({ hasText: lastId }).press("Enter");
  await expect(stepName).toBeFocused();
  await expect(question).toHaveValue("Which scenario changes the decision?");
  await search.fill(lastId);
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator("code")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo last edit", exact: true })).toBeDisabled();
  await expect(page.locator(".save-state")).toHaveText(`Revision ${revision.number}`);
});

test("distinguish equally named pinned definitions only when their displayed versions match", async ({
  page,
  request,
}) => {
  const baseline = { id: "baseline-risk", version: 1 };
  const rival = { id: "rival-risk", version: 1 };
  const newer = { ...baseline, version: 2 };
  const workflow: Workflow = {
    schema_version: "0.2",
    ...chain("Risk workflows", [
      step("apply_baseline", "Baseline risk", "subgraph", "", { type: "subgraph", ref: baseline }),
      step("apply_rival", "Rival risk", "subgraph", "", { type: "subgraph", ref: rival }),
      step("apply_newer", "Updated baseline", "subgraph", "", { type: "subgraph", ref: newer }),
    ]),
    subgraphs: [
      {
        ...baseline,
        ...chain("Risk analysis", [
          step("review", "Assess risk", "review", "Which observation supports the base case?"),
          step("review_again", "Assess risk", "review", "Would a later release change the case?"),
        ]),
      },
      {
        ...rival,
        ...chain("Risk analysis", [
          step("review", "Assess risk", "review", "How does the alternative evidence change risk?"),
        ]),
      },
      {
        ...newer,
        ...chain("Risk analysis", [
          step("review", "Assess risk", "review", "What changes in the newer version?"),
        ]),
      },
    ],
  };
  const saved = await request.post("/api/revisions", { data: workflow });
  expect(saved.status(), await saved.text()).toBe(201);
  const revision = await saved.json();
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(`/?revision=${revision.id}`);

  const search = page.getByRole("searchbox", { name: "Find a step", exact: true });
  const results = page.getByRole("list", { name: "Matching steps" });
  const rows = results.getByRole("button");
  await search.fill("Assess risk");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0).locator("code")).toHaveText([baseline.id, "review"]);
  await expect(rows.nth(1).locator("code")).toHaveText([baseline.id, "review_again"]);
  await expect(rows.nth(2).locator("code")).toHaveText(rival.id);
  await expect(rows.nth(3)).toHaveAccessibleName("Assess risk Review Risk analysis · v2");
  await expect(rows.nth(3).locator("code")).toHaveCount(0);

  await rows.filter({ hasText: rival.id }).press("Enter");
  await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toBeFocused();
  const question = page.getByRole("textbox", { name: "Review question", exact: true });
  await expect(question).toHaveValue("How does the alternative evidence change risk?");
  const crumbs = page.getByRole("navigation", { name: "Graph breadcrumbs" });
  await expect(
    crumbs.getByRole("button", { name: "Risk analysis v1", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(crumbs.getByRole("button", { name: workflow.name })).toHaveAccessibleDescription(
    "Return to Rival risk",
  );
  await expect(page.getByRole("button", { name: "Undo last edit", exact: true })).toBeDisabled();
});
