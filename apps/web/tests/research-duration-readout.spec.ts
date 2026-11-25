import { expect, test } from "./fixtures";

for (const width of [320, 1440]) {
  test(`read the active time limit while editing it at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    await page.goto("/");
    await page.getByRole("link", { name: "Research settings", exact: true }).press("Enter");
    const limit = page.getByRole("spinbutton", { name: "Active time limit (seconds)" });
    const duration = page.locator("#study-active-limit-duration");

    await expect(limit).toHaveValue("1800");
    await expect(limit).toHaveAccessibleDescription("30 min");
    await expect(duration).toBeInViewport();
    await limit.fill("1850");
    await expect(limit).toHaveAccessibleDescription("30 min 50 sec");
    await expect(duration).toHaveText("30 min 50 sec");
    await expect(duration).toBeInViewport();
    await limit.fill("59");
    await expect(limit).toHaveAccessibleDescription("1 to 60 min");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
