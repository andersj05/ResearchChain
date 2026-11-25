import { expect, test, type Page } from "./fixtures";

const destinations = [
  { name: "Workflows", view: "workflow", tab: "Build" },
  { name: "Sources", view: "evidence", tab: "Sources" },
  { name: "Reports", view: "reports", tab: "Reports" },
] as const;
const fileName = "synthetic-weekly-release.txt";
const fileTitle = "Release note renamed in the queue";
const pastedTitle = "Synthetic desk conversation";
const pastedText = "Compare the first release.\nUse the same observation cutoff.";
const description = "Opens in a new tab to keep queued files.";

async function expectDestination(page: Page, destination: (typeof destinations)[number]) {
  await expect(page).toHaveURL(new RegExp(`[?&]view=${destination.view}(?:&|$)`));
  await expect(page.getByRole("tab", { name: destination.tab, exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

test("protects unpinned files from reload while reading the study archive", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=research");
  await page.getByLabel("Source files").setInputFiles({
    name: fileName,
    mimeType: "text/plain",
    buffer: Buffer.from("Keep this unpinned synthetic file when canceling a reload."),
  });
  const title = page.getByLabel(`Packet title for ${fileName}`);
  await title.fill(fileTitle);
  const nav = page.getByRole("navigation", { name: "Research navigation" });
  await nav.getByRole("link", { name: "Studies", exact: true }).click();
  await expect(page).toHaveURL(/studies=1/);

  const [warning] = await Promise.all([
    page.waitForEvent("dialog", { timeout: 5000 }),
    page.evaluate(() => {
      setTimeout(() => window.location.reload(), 0);
    }),
  ]);
  expect(warning.type()).toBe("beforeunload");
  await warning.dismiss();
  await page.getByRole("link", { name: "Research desk", exact: true }).click();
  await expect(title).toHaveValue(fileTitle);
  await page.getByRole("button", { name: `Remove queued ${fileName}` }).click();
  await expect(title).toHaveCount(0);

  const extraWarnings: string[] = [];
  page.on("dialog", async (dialog) => {
    extraWarnings.push(dialog.type());
    await dialog.accept();
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "New study", exact: true })).toBeVisible();
  expect(extraWarnings).toEqual([]);
});

for (const width of [390, 1440]) {
  test(`keeps staged files when using the current Research desk link at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(width === 390 ? "/" : "/?view=research");
    const desk = page.getByRole("heading", { name: "New study", exact: true });
    await page.getByLabel("Source files").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic material for the current desk draft."),
    });
    const title = page.getByLabel(`Packet title for ${fileName}`);
    await title.fill(fileTitle);
    const token = crypto.randomUUID();
    await page.evaluate((value) => Reflect.set(window, "deskHomeVisit", value), token);

    const home = page.getByRole("link", { name: "Research desk", exact: true });
    await home.press("Enter");
    await expect(desk).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, "deskHomeVisit"))).toBe(token);
    await expect(desk).toBeFocused();
    await expect(desk).toBeInViewport({ ratio: 1 });
    await expect(title).toHaveValue(fileTitle);
  });

  test(`opens Workbench destinations in new tabs only with queued Desk files at ${width}px`, async ({
    page,
    context,
  }) => {
    let admissions = 0;
    await context.route("**/api/research-sessions", (route) => {
      if (route.request().method() !== "POST") return route.continue();
      admissions += 1;
      return route.abort();
    });
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const desk = page.getByRole("heading", { name: "New study", exact: true });
    const nav = page.getByRole("navigation", { name: "Research navigation" });
    const links = destinations.map(({ name }) => nav.getByRole("link", { name, exact: true }));
    const capture = page.getByRole("region", { name: "Add material" });
    const queue = capture.getByRole("list", { name: "Files to pin" });
    const notice = capture.getByText(
      "Workflows, Sources, and Reports open in new tabs while files are queued.",
      { exact: true },
    );
    const paste = capture.getByRole("form", { name: "Paste a source" });
    const conversation = paste.getByLabel("Conversation excerpt");

    async function expectSameTabLinks() {
      for (const link of links) {
        await expect(link).not.toHaveAttribute("target", "_blank");
        await expect(link).not.toHaveAttribute("aria-description", description);
      }
    }

    async function openAndReturn(destination: (typeof destinations)[number]) {
      await nav.getByRole("link", { name: destination.name, exact: true }).press("Enter");
      await expectDestination(page, destination);
      expect(context.pages()).toHaveLength(1);
      await page.getByRole("link", { name: "Research desk", exact: true }).press("Enter");
      await expect(desk).toBeVisible();
    }

    await expect(desk).toBeVisible();
    await expectSameTabLinks();
    await expect(notice).toHaveCount(0);
    await openAndReturn(destinations[0]);
    await paste.getByRole("button", { name: "Conversation", exact: true }).press("Enter");
    await paste.getByLabel("Source title").fill(pastedTitle);
    await conversation.fill(pastedText);
    await capture.getByLabel("Usage rights").selectOption("permission");
    await expectSameTabLinks();
    await expect(notice).toHaveCount(0);
    await openAndReturn(width === 390 ? destinations[1] : destinations[2]);
    await expect(conversation).toHaveValue(pastedText);
    await expect(paste.getByLabel("Source title")).toHaveValue(pastedTitle);

    await capture.getByLabel("Source files").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("This synthetic file is staged on the Desk."),
    });
    const fileField = queue.getByLabel(`Packet title for ${fileName}`);
    await fileField.fill(fileTitle);
    await queue.locator("summary").press("Enter");
    await queue.getByLabel("Author / speaker").fill("One file author");
    await queue.getByLabel("As-of date").fill("2026-11-21");
    await expect(notice).toBeVisible();
    const originalUrl = page.url();
    const token = crypto.randomUUID();
    await page.evaluate((value) => Reflect.set(window, "queuedStudyNavigation", value), token);
    for (const destination of destinations) {
      const link = nav.getByRole("link", { name: destination.name, exact: true });
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener");
      await expect(link).toHaveAccessibleDescription(description);
      const opening = context.waitForEvent("page");
      await link.press("Enter");
      const newTab = await opening;
      try {
        await newTab.setViewportSize({ width, height: 844 });
        await expectDestination(newTab, destination);
        expect(await newTab.evaluate(() => window.opener)).toBeNull();
      } finally {
        await newTab.close();
      }
      await page.bringToFront();
      await expect(link).toBeFocused();
      await expect(page).toHaveURL(originalUrl);
      await expect(fileField).toHaveValue(fileTitle);
      await expect(queue.getByLabel("Author / speaker")).toHaveValue("One file author");
      await expect(queue.getByLabel("As-of date")).toHaveValue("2026-11-21");
      await expect(conversation).toHaveValue(pastedText);
    }
    expect(await page.evaluate(() => Reflect.get(window, "queuedStudyNavigation"))).toBe(token);
    const positions = await nav
      .getByRole("link")
      .evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
    expect(positions).toHaveLength(6);
    expect(new Set(positions).size).toBe(1);

    if (width === 390) {
      await queue.getByRole("button", { name: `Remove queued ${fileName}` }).press("Enter");
    } else {
      const release = Promise.withResolvers<void>();
      let pinRequests = 0;
      await page.route("**/api/evidence", async (route) => {
        const request = route.request();
        if (request.method() === "POST" && request.postDataJSON().title === fileTitle) {
          pinRequests += 1;
          await release.promise;
        }
        await route.continue();
      });
      try {
        await capture.getByRole("button", { name: "Pin 1 file", exact: true }).press("Enter");
        await expect.poll(() => pinRequests).toBe(1);
        await nav.getByRole("link", { name: "Methodology", exact: true }).press("Enter");
        await expect(page).toHaveURL(/view=methodology/);
        await expect(nav.getByRole("link", { name: "Workflows", exact: true })).toHaveAttribute(
          "target",
          "_blank",
        );
        release.resolve();
        await expectSameTabLinks();
        await page.getByRole("link", { name: "Research desk", exact: true }).press("Enter");
        await expect(page.getByRole("list", { name: "Pinned material" })).toContainText(fileTitle);
      } finally {
        release.resolve();
      }
    }
    await expect(queue).toHaveCount(0);
    await expect(notice).toHaveCount(0);
    await expectSameTabLinks();
    await expect(conversation).toHaveValue(pastedText);
    expect(admissions).toBe(0);
  });
}
