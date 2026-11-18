import advanced from "../../../examples/advanced-workflow.json";
import type { Workflow } from "../src/lib/workflow";
import { branchPaths } from "../src/lib/workflow-branch-paths";
import { addTemplate } from "../src/lib/workflow-editing";
import { expect, test } from "./fixtures";

test("inspect nested Branch paths, navigate by keyboard, and see wiring changes", async ({
  page,
  request,
}) => {
  const nested = addTemplate(
    structuredClone(advanced) as Workflow,
    null,
    "route",
    "support",
    "before",
  );
  const { workflow } = addTemplate(nested.workflow, null, "subgraph", "support");
  const response = await request.post("/api/revisions", { data: workflow });
  expect(response.status(), await response.text()).toBe(201);
  const revision = await response.json();
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(`/?revision=${revision.id}`);

  const paths = page.locator(".branch-paths");
  const branch = (label: string) =>
    paths.getByRole("list", { name: `${label} steps`, exact: true });
  const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
  const undo = page.getByRole("button", { name: "Undo last edit", exact: true });
  const returnToFork = page.getByRole("button", { name: "Return to step Split", exact: true });
  const support = branch("support");

  await expect(support).toBeHidden();
  await paths.getByText("Branch paths", { exact: true }).press("Enter");
  await expect(paths.getByText("All branches run. The join waits for all of them.")).toBeVisible();
  await expect(support.getByRole("button")).toHaveText([
    "First step · New condition",
    "If true",
    "If false",
    "Join branches",
    "Support",
    "New subgraph",
  ]);
  await expect(branch("challenge").getByRole("button")).toHaveText(["First step · Challenge"]);

  await paths.getByRole("button", { name: "Paired join · Join", exact: true }).press("Enter");
  await expect(stepName).toHaveValue("Join");
  await expect(stepName).toBeFocused();
  await returnToFork.press("Enter");
  await expect(stepName).toHaveValue("Split");
  await support
    .getByRole("button", { name: "First step · New condition", exact: true })
    .press("Enter");
  await expect(stepName).toHaveValue("New condition");
  await expect(stepName).toBeFocused();
  await expect(paths.getByText("Only the path matching the condition runs.")).toBeVisible();
  await expect(branch("If true").getByRole("button")).toHaveText(["First step · If true"]);
  await expect(branch("If false").getByRole("button")).toHaveText(["First step · If false"]);
  await expect(undo).toBeDisabled();
  await expect(page.locator(".save-state")).toHaveText(`Revision ${revision.number}`);

  await page.getByRole("combobox", { name: "Next step (true)", exact: true }).selectOption("");
  await expect(paths.getByText("No next step connected.")).toBeVisible();
  await expect(branch("If true")).toHaveCount(0);
  await returnToFork.press("Enter");
  await expect(paths.getByText("This path does not resolve to the paired join.")).toBeVisible();
  await expect(support.getByRole("button")).toHaveText(["First step · New condition", "If false"]);
  await undo.click();
  await expect(support.getByRole("button", { name: "If true", exact: true })).toBeVisible();
  await expect(paths.getByText("This path does not resolve to the paired join.")).toHaveCount(0);

  await page.getByRole("textbox", { name: "Branch 1 name", exact: true }).fill("base-case");
  await expect(
    branch("base-case").getByRole("button", { name: "First step · New condition" }),
  ).toBeVisible();
  await expect(support).toHaveCount(0);
});

test("Branch paths stop at joins and flag cyclic and overlapping draft wiring", () => {
  const draft = addTemplate(structuredClone(advanced) as Workflow, null, "note", "support");
  const graph = draft.workflow;
  const split = graph.nodes.find((node) => node.id === "split")!;

  const support = branchPaths(graph, split)?.branches.find((branch) => branch.name === "support");
  expect(support?.first?.id).toBe("support");
  expect(support?.steps.map((step) => step.id)).toEqual([draft.selected]);
  expect(support?.issue).toBeUndefined();

  const next = graph.edges.find((edge) => edge.source === draft.selected)!;
  next.target = "support";
  const cyclic = branchPaths(graph, split)?.branches.find((branch) => branch.name === "support");
  expect(cyclic?.steps.map((step) => step.id)).toEqual([draft.selected]);
  expect(cyclic?.issue).toContain("does not resolve");

  next.target = "join";
  const other = graph.edges.find(
    (edge) => edge.source === "split" && edge.source_port === "challenge",
  )!;
  other.target = "support";
  expect(branchPaths(graph, split)?.branches.map((branch) => branch.issue)).toEqual([
    "Branches share the first step.",
    "Branches share the first step.",
  ]);
});
