import { expect, test } from "./fixtures";
import advanced from "../../../examples/advanced-workflow.json";
import macro from "../../../examples/discretionary-macro.json";
import { insertStep } from "../src/lib/workflow-editing";
import type { Workflow } from "../src/lib/workflow";

test("unwind a cycle of deliberate Build links in reverse order", async ({ page, request }) => {
  const saved = await request.post("/api/revisions", { data: macro });
  expect(saved.status(), await saved.text()).toBe(201);
  const revision = await saved.json();
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(`/?revision=${revision.id}`);

  const review = "Choose the question and horizon";
  const pricing = "Estimate what markets price";
  const check = "Run the discriminating test";
  const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
  const back = page.getByRole("button", { name: /^Return to step / });
  await page
    .locator(".node-outline")
    .getByRole("button", { name: /^Choose the question/ })
    .click();
  await page.getByRole("button", { name: `${pricing} · feedback`, exact: true }).press("Enter");
  await expect(stepName).toHaveValue(pricing);
  await expect(page.getByRole("combobox", { name: "Reviewer feedback" })).toBeFocused();
  await page.getByText("Output bindings", { exact: true }).press("Enter");
  await page.getByRole("button", { name: `text → ${check} · context`, exact: true }).press("Enter");
  await expect(stepName).toHaveValue(check);
  await expect(page.getByRole("combobox", { name: "Context input" })).toBeFocused();
  await page
    .getByRole("button", { name: `Open source ${review} for Reviewer feedback`, exact: true })
    .press("Enter");
  await expect(stepName).toHaveValue(review);

  for (const step of [check, pricing, review]) {
    await expect(back).toHaveAccessibleName(`Return to step ${step}`);
    await back.press("Enter");
    await expect(stepName).toHaveValue(step);
    await expect(stepName).toBeFocused();
  }
  await expect(back).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo last edit", exact: true })).toBeDisabled();
  await expect(page.locator(".save-state")).toHaveText(`Revision ${revision.number}`);
});

test("skip the current step in return history and clear history after loading a revision", async ({
  page,
  request,
}) => {
  const earlier = await request.post("/api/revisions", { data: { ...advanced, name: "Earlier" } });
  expect(earlier.status(), await earlier.text()).toBe(201);
  const earlierRevision = await earlier.json();
  const latest = await request.post("/api/revisions", { data: advanced });
  expect(latest.status(), await latest.text()).toBe(201);
  const latestRevision = await latest.json();
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(`/?revision=${latestRevision.id}`);

  const search = page.getByRole("searchbox", { name: "Find a step", exact: true });
  const outline = page.locator(".node-outline");
  const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
  const back = page.getByRole("button", { name: /^Return to step / });
  const crumbs = page.getByRole("navigation", { name: "Graph breadcrumbs" });
  await search.fill("ready for the next pass");
  await search.press("Enter");
  await expect(stepName).toHaveValue("Review");
  await search.fill("what would falsify it");
  await search.press("Enter");
  await expect(stepName).toHaveValue("Challenge");
  await search.fill("supporting observation");
  await search.press("Enter");
  await expect(stepName).toHaveValue("Support");

  await expect(back).toHaveAccessibleName("Return to step Challenge");
  await search.clear();
  await outline.getByRole("button", { name: "Challenge Note", exact: true }).click();
  await expect(back).toHaveAccessibleName("Return to step Review");
  await back.press("Enter");
  await expect(stepName).toHaveValue("Review");
  await expect(stepName).toBeFocused();
  await expect(crumbs.getByRole("button", { name: "Critique and review v1" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(back).toHaveAccessibleName("Return to step Split");
  await expect(page.getByRole("button", { name: "Undo last edit", exact: true })).toBeDisabled();

  await page.getByRole("tab", { name: "Versions", exact: true }).click();
  await page
    .getByRole("button", { name: `Load revision ${earlierRevision.number}`, exact: true })
    .click();
  await expect(stepName).toHaveValue("Split");
  await expect(back).toHaveCount(0);
  await expect(crumbs).toHaveCount(0);
  await expect(page.locator(".save-state")).toHaveText(`Revision ${earlierRevision.number}`);
});

test("distinguish the same review reached through two pinned callers in return history", async ({
  page,
  request,
}) => {
  const graph = structuredClone(advanced) as Workflow;
  const loop = graph.nodes.find((step) => step.id === "review_loop")!;
  const sibling = { ...structuredClone(loop), id: "second_loop", label: "Second review loop" };
  const workflow = insertStep(graph, sibling, loop.id);
  const saved = await request.post("/api/revisions", { data: workflow });
  expect(saved.status(), await saved.text()).toBe(201);
  const revision = await saved.json();
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(`/?revision=${revision.id}`);

  const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
  const edit = page.getByRole("button", { name: "Edit subgraph", exact: true });
  const crumbs = page.getByRole("navigation", { name: "Graph breadcrumbs" });
  const root = crumbs.getByRole("button", { name: workflow.name, exact: true });
  const back = page.getByRole("button", { name: /^Return to step / });
  await page
    .locator(".node-outline")
    .getByRole("button", { name: /^Review_Loop/ })
    .click();
  await edit.click();
  await expect(stepName).toHaveValue("Review");
  await page.getByText("Used by 2 draft references", { exact: true }).click();
  await page.getByRole("button", { name: "Open step Second review loop in Root workflow" }).click();
  await expect(stepName).toHaveValue("Second review loop");
  await edit.click();
  await expect(stepName).toHaveValue("Review");
  await expect(root).toHaveAccessibleDescription("Return to Second review loop");
  await expect(back).toHaveAccessibleName("Return to step Review");
  await back.press("Enter");
  await expect(stepName).toHaveValue("Review");
  await expect(stepName).toBeFocused();
  await expect(root).toHaveAccessibleDescription("Return to Review_Loop");
  await expect(back).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo last edit", exact: true })).toBeDisabled();
});
