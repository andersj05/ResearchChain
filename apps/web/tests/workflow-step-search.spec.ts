import { expect, test } from "./fixtures";
import workflow from "../../../examples/advanced-workflow.json";
import macro from "../../../examples/discretionary-macro.json";

test("find a nested review by its question and return to an editable root step", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/revisions", { data: workflow });
  expect(response.status()).toBe(201);
  const revision = await response.json();
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(`/?revision=${revision.id}`);
  const search = page.getByRole("searchbox", { name: "Find a step" });
  const matches = page.getByRole("list", { name: "Matching steps" });
  const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
  const instructions = page.getByRole("textbox", { name: "Instructions", exact: true });
  const breadcrumbs = page.getByRole("navigation", { name: "Graph breadcrumbs" });
  await search.fill("ready for the next pass");
  await expect(matches.getByRole("listitem")).toHaveCount(1);
  await expect(matches.getByRole("button")).toContainText("Critique and review · v1");
  await search.press("Enter");
  await expect(breadcrumbs).toContainText("Critique and review");
  await expect(stepName).toHaveValue("Review");
  await expect(instructions).toHaveValue("Is this reasoning ready for the next pass?");

  await search.fill("what would falsify it");
  await matches.getByRole("button", { name: /Challenge/ }).click();
  await expect(stepName).toHaveValue("Challenge");
  await expect(breadcrumbs).toHaveCount(0);
  await expect(page.locator(".save-state")).toHaveText(`Revision ${revision.number}`);
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(matches).toHaveCount(0);
  await expect(stepName).toHaveValue("Challenge");

  const macroResponse = await request.post("/api/revisions", { data: macro });
  expect(macroResponse.status()).toBe(201);
  await page.goto(`/?revision=${(await macroResponse.json()).id}`);
  await search.fill(macro.research.model);
  await expect(matches.getByRole("listitem")).toHaveCount(
    macro.nodes.filter((node) => node.kind === "research").length,
  );
});
