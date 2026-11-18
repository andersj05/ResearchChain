import { expect, test } from "./fixtures";
import macro from "../../../examples/discretionary-macro.json";
import example from "../../../examples/research-workflow.json";
import { addTemplate, referenceOf } from "../src/lib/workflow-editing";
import type { Workflow } from "../src/lib/workflow";

test("filter macro reviews and model steps through pinned nested scopes on mobile", async ({
  page,
  request,
}) => {
  const nested = addTemplate(structuredClone(macro) as Workflow, null, "subgraph", "challenge");
  const ref = referenceOf(nested.workflow.nodes.find((node) => node.id === nested.selected)!)!;
  const model = addTemplate(nested.workflow, ref, "model", "step");
  const pinned = model.workflow.subgraphs![0]!;
  pinned.name = "Positioning checks";
  pinned.nodes[0]!.kind = "review";
  pinned.nodes[0]!.label = "Weigh positioning evidence";
  pinned.nodes.find((node) => node.id === model.selected)!.label = "Map the positioning squeeze";
  const newer = structuredClone(pinned);
  newer.version = 2;
  newer.nodes[0]!.label = "Weigh the newer draft";
  model.workflow.subgraphs!.push(newer);
  const saved = await request.post("/api/revisions", { data: model.workflow });
  expect(saved.status()).toBe(201);
  await page.setViewportSize({ width: 390, height: 950 });
  await page.goto(`/?revision=${(await saved.json()).id}`);
  const filter = page.getByRole("combobox", { name: "Filter steps by type", exact: true });
  const search = page.getByRole("searchbox", { name: "Find a step", exact: true });
  const matches = page.getByRole("list", { name: "Matching steps", exact: true });
  const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
  const crumbs = page.getByRole("navigation", { name: "Graph breadcrumbs", exact: true });
  const outline = page.locator(".node-outline");
  await expect(filter).toHaveValue("all");
  await expect(search).toHaveValue("");
  await expect(matches).toHaveCount(0);
  await expect(outline.getByRole("listitem")).toHaveCount(model.workflow.nodes.length);

  await filter.selectOption("review");
  await expect(matches.getByRole("listitem")).toHaveCount(4);
  for (const step of macro.nodes.filter((node) => node.kind === "review")) {
    await expect(matches.getByRole("button", { name: new RegExp(step.label) })).toBeVisible();
  }
  await expect(matches.getByRole("button", { name: /Weigh the newer draft/ })).toHaveCount(0);
  const review = matches.getByRole("button", { name: /Weigh positioning evidence/ });
  await expect(review).toContainText("Positioning checks · v1");
  await search.fill("weigh positioning");
  await expect(matches.getByRole("listitem")).toHaveCount(1);
  await search.press("Enter");
  await expect(crumbs).toContainText("Positioning checks v1");
  await expect(stepName).toHaveValue("Weigh positioning evidence");
  await expect(stepName).toBeFocused();
  await page
    .getByRole("button", { name: "Return to step Find the cross-asset tension" })
    .press("Enter");
  await expect(stepName).toHaveValue("Find the cross-asset tension");
  await expect(crumbs).toHaveCount(0);
  await search.press("Escape");
  await expect(filter).toHaveValue("review");
  await expect(matches.getByRole("listitem")).toHaveCount(4);

  await filter.selectOption("research");
  await expect(matches.getByRole("listitem")).toHaveCount(
    macro.nodes.filter((node) => node.kind === "research").length + 1,
  );
  await expect(matches.getByRole("button", { name: /Run the discriminating test/ })).toBeVisible();
  await expect(
    matches.getByRole("button", { name: /Choose the question and horizon/ }),
  ).toHaveCount(0);
  await search.fill("positioning squeeze");
  await expect(matches.getByRole("listitem")).toHaveCount(1);
  await filter.selectOption("review");
  await expect(matches.getByRole("listitem")).toHaveCount(0);
  await expect(page.getByText("No matching steps.", { exact: true })).toBeVisible();
  await filter.selectOption("research");
  await search.press("Enter");
  await expect(stepName).toHaveValue("Map the positioning squeeze");
  await expect(crumbs).toContainText("Positioning checks v1");
  await search.press("Escape");
  await filter.selectOption("all");
  await expect(matches).toHaveCount(0);
  await expect(outline.getByRole("listitem")).toHaveCount(pinned.nodes.length);
  await expect(outline.getByRole("button", { name: /Weigh positioning evidence/ })).toBeVisible();
  await expect(outline.getByRole("button", { name: /Find the cross-asset tension/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Undo last edit", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("filtered step matches paginate and reset when the search or type changes", async ({
  page,
  request,
}) => {
  let workflow = structuredClone(example) as Workflow;
  let selected = workflow.start_node;
  for (let i = 1; i <= 32; i++) {
    ({ workflow, selected } = addTemplate(workflow, null, "review", selected));
    workflow.nodes.find((node) => node.id === selected)!.label = `Risk checkpoint ${i}`;
  }
  const saved = await request.post("/api/revisions", { data: workflow });
  expect(saved.status()).toBe(201);
  await page.goto(`/?revision=${(await saved.json()).id}`);
  const filter = page.getByRole("combobox", { name: "Filter steps by type", exact: true });
  const search = page.getByRole("searchbox", { name: "Find a step", exact: true });
  const results = page
    .getByRole("list", { name: "Matching steps", exact: true })
    .getByRole("listitem");
  const more = page.getByRole("button", { name: "Show more matches", exact: true });
  await filter.selectOption("review");
  await expect(results).toHaveCount(30);
  await more.click();
  await expect(results).toHaveCount(33);
  await search.fill("risk checkpoint");
  await expect(results).toHaveCount(30);
  await more.click();
  await expect(results).toHaveCount(32);
  await filter.selectOption("all");
  await expect(results).toHaveCount(30);
});
