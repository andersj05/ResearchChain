import { expect, test } from "./fixtures";

for (const width of [320, 390]) {
  test(`all Workbench destinations fit the first row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    await page.goto("/?view=workflow");
    const navigation = page.getByRole("tablist", { name: "Workspace", exact: true });
    const status = navigation.getByRole("tab", { name: "Status", exact: true });
    await expect(status).toBeEnabled();
    const geometry = await navigation.evaluate(async (nav) => {
      await document.fonts.ready;
      const { left, right, top } = nav.getBoundingClientRect();
      const tabs = [...nav.querySelectorAll<HTMLElement>("[role=tab]")];
      return {
        count: tabs.length,
        clipped: tabs.flatMap((tab) => {
          const bounds = tab.getBoundingClientRect();
          return bounds.left < left - 0.5 || bounds.right > right + 0.5 || bounds.top > top + 1
            ? [tab.textContent]
            : [];
        }),
      };
    });
    expect(geometry).toEqual({ count: 7, clipped: [] });

    await status.click();
    await expect(page.getByRole("heading", { name: "Operations", exact: true })).toBeVisible();
    await status.press("ArrowLeft");
    await expect(navigation.getByRole("tab", { name: "Versions", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
}
