import { expect, test } from "./fixtures";

for (const width of [390, 1440]) {
  test(`Research settings shortcuts reopen collapsed controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const navigation = page.getByRole("navigation", { name: "Study sections" });
    const firstReading = page.getByRole("complementary", { name: "Prepare the first reading" });
    const summary = page.locator("summary").filter({ hasText: /^Research settings/ });
    const settings = page.getByRole("region", { name: "Research settings", exact: true });
    const passes = page.getByRole("spinbutton", { name: "Passes per agent" });

    await expect(passes).toBeEnabled();
    await passes.fill("7");
    for (const shortcut of [
      navigation.getByRole("link", { name: "Research settings", exact: true }),
      firstReading.getByRole("link", { name: "Change research settings", exact: true }),
    ]) {
      await summary.press("Enter");
      await expect(passes).toBeHidden();
      await shortcut.press("Enter");
      await expect(passes).toBeVisible();
      await expect(settings).toBeFocused();
      await expect(passes).toHaveValue("7");
      await expect(passes).toBeInViewport({ ratio: 1 });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
