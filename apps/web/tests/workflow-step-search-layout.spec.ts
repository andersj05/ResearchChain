import { expect, test, type Locator } from "./fixtures";
import macro from "../../../examples/discretionary-macro.json";

async function top(locator: Locator) {
  return (await locator.boundingBox())!.y;
}

async function expectWrappedLabel(label: Locator) {
  await expect(label).toBeVisible();
  const rendered = await label.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const bounds = element.getBoundingClientRect();
    const lines = Array.from(range.getClientRects());
    return {
      wraps: lines.length > 1,
      fits: lines.every((line) => line.left >= bounds.left - 1 && line.right <= bounds.right + 1),
    };
  });
  expect(rendered).toEqual({ wraps: true, fits: true });
}

const longReviewName =
  "Decide whether payrolls, front-end rates, and FX positioning support the same policy-path thesis";

for (const width of [390, 1440]) {
  test(`Build puts step search before insertion controls at ${width}px`, async ({
    page,
    request,
  }) => {
    const workflow = structuredClone(macro);
    workflow.nodes.find((node) => node.id === "mandate")!.label = longReviewName;
    const saved = await request.post("/api/revisions", { data: workflow });
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
    await expectWrappedLabel(outline.getByText(longReviewName, { exact: true }));

    await filter.selectOption("review");
    await expect(results.getByRole("listitem")).toHaveCount(3);
    const review = results.getByRole("button", { name: longReviewName, exact: true });
    await expectWrappedLabel(review.getByText(longReviewName, { exact: true }));
    const resultBox = (await results.boundingBox())!;
    expect(resultBox.y).toBeGreaterThan(await top(search));
    expect(resultBox.y + resultBox.height).toBeLessThan(await top(placement));
    await expect(panel.locator(".node-library").getByRole("button")).toHaveCount(10);

    await search.press("Enter");
    await expect(stepName).toHaveValue(longReviewName);
    await expect(stepName).toBeFocused();
    await page
      .getByRole("button", { name: "Return to step Find the cross-asset tension" })
      .press("Enter");
    await expect(stepName).toHaveValue("Find the cross-asset tension");
    await expect(undo).toBeDisabled();

    await review.click();
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
