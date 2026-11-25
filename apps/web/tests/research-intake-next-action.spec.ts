import { expect, test } from "./fixtures";
import type { EvidenceInput } from "../src/lib/evidence";

for (const width of [320, 390, 1440]) {
  test(`finds unfinished material from a blank packet at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 400 ? 740 : 900 });
    const pins: EvidenceInput[] = [];
    await page.route("**/api/evidence", (route) => {
      const request = route.request();
      if (request.method() === "POST") pins.push(request.postDataJSON());
      return route.continue();
    });
    let starts = 0;
    await page.route("**/api/research-sessions", (route) => {
      if (route.request().method() !== "POST") return route.continue();
      starts++;
      return route.abort();
    });
    await page.goto("/");
    const start = page.getByRole("button", { name: "Ask the lead for a first reading" });
    const status = page.locator("#first-reading-status");
    await expect(start).toBeDisabled();
    await expect(status.getByRole("link", { name: "Pin a source to begin" })).toBeInViewport();

    const capture = page.getByRole("region", { name: "Add material" });
    const paste = capture.getByRole("form", { name: "Paste a source" });
    const queue = capture.getByRole("list", { name: "Files to pin" });
    const fileName = "first-desk-source.txt";
    await capture.getByLabel("Source files").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic observations from the weekly packet."),
    });
    await queue.getByLabel(`Packet title for ${fileName}`).fill("First weekly observations");
    await paste.getByLabel("Source title").fill("First pasted observation");
    await paste.getByLabel("Note text").fill("The synthetic groups diverged on Friday.");

    const navigation = page.getByRole("navigation", { name: "Study sections" });
    await navigation.getByRole("link", { name: "Research settings" }).press("Enter");
    await expect(start).toBeInViewport();
    await expect(start).toBeDisabled();
    await expect(queue).not.toBeInViewport();
    await expect(paste).not.toBeInViewport();
    const queuedLink = status.getByRole("link", { name: "Review queued files" });
    const pasteLink = status.getByRole("link", { name: "Finish pasted source" });
    await expect(queuedLink).toBeInViewport();
    await expect(pasteLink).toBeInViewport();
    expect(pins).toHaveLength(0);
    expect(starts).toBe(0);

    await queuedLink.press("Enter");
    await expect(queue).toBeFocused();
    await expect(queue).toBeInViewport();
    const pinFile = capture.getByRole("button", { name: "Pin 1 file" });
    const pinNote = paste.getByRole("button", { name: "Pin note" });
    await expect(pinFile).toBeDisabled();
    await expect(pinNote).toBeDisabled();
    await capture.getByLabel("Usage rights").selectOption("permission");
    await capture.getByLabel("Author or speaker").fill("Synthetic desk");
    await capture.getByLabel("As of").fill("2026-11-20");
    await pinFile.click();
    await expect(queuedLink).toHaveCount(0);
    await expect(pasteLink).toBeInViewport();
    await expect(start).toBeDisabled();
    await pasteLink.press("Enter");
    await expect(paste).toBeFocused();
    await expect(paste).toBeInViewport();
    await expect(paste.getByLabel("Note text")).toHaveValue(
      "The synthetic groups diverged on Friday.",
    );
    await pinNote.click();
    await expect(start).toBeEnabled();
    await expect(status.getByRole("link", { name: "2 sources pinned" })).toBeVisible();
    const pinned = page.getByRole("list", { name: "Pinned material" });
    await expect(pinned.getByRole("listitem")).toHaveCount(2);
    expect(pins).toMatchObject([
      {
        title: "First weekly observations",
        rights: "permission",
        author: "Synthetic desk",
        as_of_date: "2026-11-20",
      },
      {
        title: "First pasted observation",
        rights: "permission",
        author: "Synthetic desk",
        as_of_date: "2026-11-20",
      },
    ]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(starts).toBe(0);
    const submitted = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/api/research-sessions"),
    );
    await start.press("Enter");
    const request = (await submitted).postDataJSON();
    expect(request).toMatchObject({
      start_from_sources: true,
      evidence_ids: pins.map(({ id }) => id),
    });
    expect(request.model).toBeTruthy();
    await expect.poll(() => starts).toBe(1);
  });
}
