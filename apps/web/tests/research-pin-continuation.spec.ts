import type { EvidenceInput } from "../src/lib/evidence";
import { expect, test, type Page } from "./fixtures";

async function fileIntake(page: Page, width = 390) {
  const pins: EvidenceInput[] = [];
  let starts = 0;
  await page.route("**/api/evidence", (route) => {
    if (route.request().method() === "POST") pins.push(route.request().postDataJSON());
    return route.fallback();
  });
  await page.route("**/api/research-sessions", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    starts++;
    return route.abort();
  });
  await page.setViewportSize({ width, height: width < 400 ? 740 : 900 });
  await page.goto("/");
  const intake = page.getByRole("region", { name: "Add material" });
  const drop = intake.getByRole("button", { name: "Drop files or browse" });
  await intake.getByLabel("Usage rights").selectOption("owned");
  return {
    drop,
    pins,
    starts: () => starts,
    packet: page.getByRole("list", { name: "Pinned material" }),
    queue: intake.getByRole("list", { name: "Files to pin" }),
    pin: intake.getByRole("button", { name: "Pin 1 file", exact: true }),
    notice: intake.getByText("1 file pinned.", { exact: true }),
    async choose(file: string) {
      const chooser = page.waitForEvent("filechooser");
      await page.keyboard.press("Enter");
      await (
        await chooser
      ).setFiles({
        name: file,
        mimeType: "text/plain",
        buffer: Buffer.from(`Synthetic observations from ${file}.`),
      });
    },
  };
}

for (const width of [320, 390, 1440]) {
  test(`finish two successive file pins using the keyboard at ${width}px`, async ({ page }) => {
    const intake = await fileIntake(page, width);
    await intake.drop.focus();
    for (const name of ["weekly-close.txt", "follow-up.txt"]) {
      await intake.choose(name);
      await expect(intake.queue).toContainText(name);
      await intake.pin.press("Enter");
      await expect(intake.packet).toContainText(name);
      await expect(intake.notice).toBeVisible();
      await expect(intake.drop).toBeFocused();
      await expect(intake.drop).toBeInViewport();
    }
    expect(intake.pins.map(({ title, rights }) => ({ title, rights }))).toEqual([
      { title: "weekly-close.txt", rights: "owned" },
      { title: "follow-up.txt", rights: "owned" },
    ]);
    const links = intake.packet.getByRole("link");
    await expect(links).toHaveCount(2);
    for (const [index, source] of intake.pins.entries())
      await expect(links.nth(index)).toHaveAttribute(
        "href",
        `/?view=evidence&evidence=${source.id}`,
      );
    expect(intake.starts()).toBe(0);
  });
}

for (const changed of ["focus", "route"] as const) {
  test(`a delayed file receipt respects changed ${changed}`, async ({ page }) => {
    const intake = await fileIntake(page);
    const sent = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    await page.route("**/api/evidence", async (route) => {
      if (route.request().method() === "POST") {
        sent.resolve();
        await release.promise;
      }
      return route.fallback();
    });
    try {
      await intake.drop.focus();
      await intake.choose("delayed-observation.txt");
      await intake.pin.press("Enter");
      await sent.promise;
      if (changed === "focus") {
        const next = page.getByRole("textbox", { name: "Study title (optional)" });
        await next.focus();
        release.resolve();
        await expect(intake.notice).toBeVisible();
        await expect(next).toBeFocused();
      } else {
        await page
          .getByRole("navigation", { name: "Research navigation" })
          .getByRole("link", { name: "Studies", exact: true })
          .press("Enter");
        const heading = page.getByRole("heading", { name: "Studies", level: 1, exact: true });
        await expect(heading).toBeFocused();
        const received = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" && response.url().endsWith("/api/evidence"),
        );
        release.resolve();
        expect((await received).ok()).toBe(true);
        await expect(heading).toBeFocused();
        await page.goBack();
        await expect(intake.notice).toBeVisible();
        await expect(intake.drop).not.toBeFocused();
      }
      await expect(intake.packet).toContainText("delayed-observation.txt");
      expect(intake.pins).toHaveLength(1);
      expect(intake.starts()).toBe(0);
    } finally {
      release.resolve();
    }
  });
}
