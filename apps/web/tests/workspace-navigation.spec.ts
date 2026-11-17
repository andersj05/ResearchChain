import { expect, test } from "./fixtures";
import example from "../../../examples/research-workflow.json";

for (const width of [1440, 390]) {
  test(`compact workspace keeps agent identity and keyboard navigation at ${width}px`, async ({
    page,
    request,
  }, info) => {
    const agent = await (
      await request.post("/api/agents", {
        data: {
          id: crypto.randomUUID(),
          workflow: { ...example, name: "My independent agent" },
        },
      })
    ).json();
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/?agent=${agent.agent.id}&view=revisions`);
    await expect(page.getByRole("tab", { name: "Versions", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const selector = page.getByRole("combobox", { name: "Agent", exact: true });
    await expect(selector).toHaveValue(agent.agent.id);
    await expect(page.locator(".topbar")).not.toContainText("ResearchChain");
    await expect(page.locator(".topbar")).not.toContainText("EquityCats");
    await expect(page.getByRole("button", { name: "Run workflow", exact: true })).toHaveCount(0);
    const build = page.getByRole("tab", { name: "Build", exact: true });
    await build.click();
    await expect(page.getByRole("button", { name: "Run workflow", exact: true })).toBeVisible();
    await build.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Sources", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "Sources", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(new URL(page.url()).searchParams.get("view")).toBe("evidence");
    await build.click();
    const identity = await selector.boundingBox();
    const settings = await page
      .getByRole("button", { name: "Settings", exact: true })
      .boundingBox();
    expect(identity!.x).toBeLessThan(settings!.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`compact-workspace-${width}.png`),
      fullPage: true,
    });
  });
}
