import { pinDeskNote } from "./desk-material";
import { expect, test } from "./fixtures";

test("keep staged files through a Studies visit and native history navigation", async ({
  page,
}) => {
  const recentReads: string[] = [];
  const summaryReads: string[] = [];
  const recentId = crypto.randomUUID();
  await page.clock.install();
  await page.route("**/api/research-sessions", (route) => {
    recentReads.push(route.request().url());
    return route.fulfill({
      json: [
        {
          id: recentId,
          study_title: "Synthetic running study",
          workflow_name: "Research session",
          status: "running",
          created_at: new Date().toISOString(),
        },
      ],
    });
  });
  await page.route("**/api/runs/reviews?*", (route) => {
    summaryReads.push(route.request().url());
    return route.fulfill({ json: { items: [], has_more: false } });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const token = crypto.randomUUID();
  await page.evaluate((token) => Reflect.set(window, "deskDocumentToken", token), token);
  await expect(page.getByRole("link", { name: "Synthetic running study" })).toBeVisible();
  await expect.poll(() => summaryReads.length).toBeGreaterThan(0);
  await page.getByLabel("Usage rights").selectOption("owned");
  await page.getByLabel("Source files").setInputFiles({
    name: "morning-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic morning notes selected from this device."),
  });
  const queue = page.getByRole("list", { name: "Files to pin" });
  const title = queue.getByLabel("Packet title for morning-notes.txt");
  await title.fill("Morning desk notes");
  await queue.locator("summary").click();
  const author = queue.getByLabel("Author / speaker");
  await author.fill("Synthetic desk participant");
  const jump = page
    .getByRole("navigation", { name: "Study sections" })
    .getByRole("link", { name: "Saved sources" });
  await jump.press("Enter");
  await expect(page.getByRole("region", { name: "Source library" })).toBeFocused();
  await expect(page).toHaveURL(/#saved-sources$/);

  const studies = page.getByRole("link", { name: "Studies", exact: true });
  const archiveHeading = page.getByRole("heading", { name: "Studies", exact: true });
  const draftHeading = page.getByRole("heading", { name: "New study", exact: true });
  await expect(studies).toHaveAttribute("href", "?view=research&studies=1");
  await studies.press("Enter");
  await expect(archiveHeading).toBeFocused();
  await expect(queue).toBeHidden();
  const counts = [recentReads.length, summaryReads.length];
  await page.clock.fastForward(20_000);
  expect([recentReads.length, summaryReads.length]).toEqual(counts);

  await page.goBack();
  await expect(page).toHaveURL(/#saved-sources$/);
  await expect(title).toHaveValue("Morning desk notes");
  await expect(author).toHaveValue("Synthetic desk participant");
  await page.goForward();
  await expect(archiveHeading).toBeVisible();
  await page.getByRole("link", { name: "New study", exact: true }).press("Enter");
  await expect(draftHeading).toBeFocused();
  await expect(title).toHaveValue("Morning desk notes");
  await expect(author).toHaveValue("Synthetic desk participant");
  expect(await page.evaluate(() => Reflect.get(window, "deskDocumentToken"))).toBe(token);

  await page.reload();
  await expect(draftHeading).toBeVisible();
  await expect(queue).toHaveCount(0);
});

test("keep a file pin that completes while Studies is open", async ({ page }) => {
  const title = "notes-during-studies.txt";
  const processed = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let posts = 0;
  await page.route("**/api/evidence", async (route) => {
    if (route.request().postDataJSON().title !== title) return route.continue();
    posts++;
    const saved = await route.fetch();
    expect(saved.status()).toBe(201);
    processed.resolve();
    await release.promise;
    await route.fulfill({ response: saved });
  });

  try {
    await page.goto("/");
    await page.getByLabel("Usage rights").selectOption("owned");
    await page.getByLabel("Source files").setInputFiles({
      name: title,
      mimeType: "text/plain",
      buffer: Buffer.from("A synthetic pin that finishes during an archive visit."),
    });
    await page.getByRole("button", { name: "Pin 1 file", exact: true }).click();
    await processed.promise;
    await page.getByRole("link", { name: "Studies", exact: true }).click();
    const studies = page.getByRole("heading", { name: "Studies", exact: true });
    await expect(studies).toBeVisible();
    const received = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/evidence") && response.request().method() === "POST",
    );
    release.resolve();
    await (await received).finished();
    await expect(studies).toBeVisible();

    await page.getByRole("link", { name: "Research desk", exact: true }).click();
    const packet = page.getByRole("list", { name: "Pinned material" });
    await expect(packet.getByRole("listitem")).toHaveCount(1);
    await expect(packet).toContainText(title);
    await expect(page.getByRole("list", { name: "Files to pin" })).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Ask the lead for a first reading" }),
    ).toBeEnabled();
    expect(posts).toBe(1);
    await page.reload();
    await expect(packet).toContainText(title);
  } finally {
    release.resolve();
  }
});

test("offer the accepted study after a pending start completes during an archive visit", async ({
  page,
  ownerSession,
}) => {
  const submitted = Promise.withResolvers<string>();
  const release = Promise.withResolvers<void>();
  const setupReads: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/^\/api\/research-sessions\/[^/]+\/setup$/.test(url.pathname))
      setupReads.push(url.pathname);
  });
  await page.route("**/api/research-sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const id = route.request().postDataJSON().id as string;
    submitted.resolve(id);
    await release.promise;
    await route.fulfill({
      status: 202,
      json: {
        run_id: id,
        command_id: crypto.randomUUID(),
        kind: "start",
        accepted_at: new Date().toISOString(),
      },
    });
  });

  try {
    await page.goto("/");
    await pinDeskNote(page);
    await page.getByRole("button", { name: "Ask the lead for a first reading" }).click();
    const id = await submitted.promise;
    await page.getByRole("link", { name: "Studies", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Studies", exact: true })).toBeVisible();
    const receipt = page.waitForResponse(
      (response) => response.url().endsWith("/api/research-sessions") && response.status() === 202,
    );
    release.resolve();
    await (await receipt).finished();
    await expect(page).toHaveURL(/studies=1/);

    await page.goBack();
    await expect(page.getByRole("heading", { name: "Study started", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open study", exact: true })).toHaveAttribute(
      "href",
      `/?session=${id}`,
    );
    expect(new URL(page.url()).searchParams.has("session")).toBe(false);
    const key = `${ownerSession.prefix}.research-brief.new`;
    const persisted = await page.evaluate(
      (key) => [sessionStorage.getItem(key), sessionStorage.getItem(`${key}.capture`)],
      key,
    );
    expect(persisted).toEqual([null, null]);
    expect(setupReads).toEqual([]);
  } finally {
    release.resolve();
  }
});
