import { expect, test, type Locator } from "./fixtures";
import macro from "../../../examples/discretionary-macro.json";

async function top(locator: Locator) {
  return (await locator.boundingBox())!.y;
}

for (const width of [390, 1440]) {
  test(`Build puts step search before insertion controls at ${width}px`, async ({
    page,
    request,
  }) => {
    const saved = await request.post("/api/revisions", { data: macro });
    expect(saved.ok(), await saved.text()).toBe(true);
    await page.setViewportSize({ width, height: 950 });
    await page.goto(`/?revision=${(await saved.json()).id}&view=workflow`);

    const panel = page.locator("#step-library");
    const heading = panel.getByRole("heading", { name: "Steps", exact: true });
    const search = panel.getByRole("searchbox", { name: "Find a step", exact: true });
    const filter = panel.getByRole("combobox", { name: "Filter steps by type", exact: true });
    const placement = panel.getByRole("combobox", { name: "Insert position", exact: true });
    const add = panel.getByRole("button", { name: "Add research note", exact: true });
    const outline = panel.locator(".node-outline");
    const results = panel.getByRole("list", { name: "Matching steps", exact: true });
    const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
    const undo = page.getByRole("button", { name: "Undo last edit", exact: true });
    await expect(add).toBeEnabled();
    await expect(outline.getByRole("listitem")).toHaveCount(macro.nodes.length);
    const headingBox = (await heading.boundingBox())!;
    expect(await top(filter)).toBeGreaterThan(headingBox.y + headingBox.height);
    expect((await top(filter)) - headingBox.y).toBeLessThan(64);
    expect(await top(search)).toBeLessThan(await top(placement));
    expect(await top(placement)).toBeLessThan(await top(add));
    expect(await top(add)).toBeLessThan(await top(outline));

    await filter.selectOption("review");
    await expect(results.getByRole("listitem")).toHaveCount(3);
    const resultBox = (await results.boundingBox())!;
    expect(resultBox.y).toBeGreaterThan(await top(search));
    expect(resultBox.y + resultBox.height).toBeLessThan(await top(placement));
    await expect(panel.locator(".node-library").getByRole("button")).toHaveCount(10);

    await search.press("Enter");
    await expect(stepName).toHaveValue("Choose the question and horizon");
    await expect(stepName).toBeFocused();
    await page
      .getByRole("button", { name: "Return to step Find the cross-asset tension" })
      .press("Enter");
    await expect(stepName).toHaveValue("Find the cross-asset tension");
    await expect(undo).toBeDisabled();

    await results.getByRole("button", { name: /Choose the question and horizon/ }).click();
    await placement.selectOption("before");
    await add.click();
    await expect(stepName).toHaveValue("New research note");
    await expect(page.getByRole("combobox", { name: "Next step", exact: true })).toHaveValue(
      "mandate",
    );
    await expect(filter).toHaveValue("review");
    await expect(results.getByRole("listitem")).toHaveCount(3);
    await undo.click();
    await filter.selectOption("all");
    await expect(results).toHaveCount(0);
    await expect(outline.getByRole("listitem")).toHaveCount(macro.nodes.length);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
}
