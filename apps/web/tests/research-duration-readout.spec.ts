import { expect, test } from "./fixtures";

for (const width of [320, 1440]) {
  test(`show assignment limits without a study timer at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    await page.goto("/");
    await page.getByRole("link", { name: "Research settings", exact: true }).press("Enter");
    await page.getByText("Optional execution limits", { exact: true }).click();
    await expect(page.getByRole("spinbutton", { name: "Passes per agent" })).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: "Turns per lead" })).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: /time limit/i })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
