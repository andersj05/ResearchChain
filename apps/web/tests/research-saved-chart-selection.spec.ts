import { expect, test } from "./fixtures";

const original = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=",
  "base64",
);
const revised = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function savedChart(digest: string, date: string) {
  return {
    id: crypto.randomUUID(),
    title: "Recorded credit curve",
    kind: "image",
    availability: "available",
    representation: "chart_screenshot",
    author: "Synthetic desk",
    as_of_date: date,
    artifact: {
      id: `sha256:${digest.repeat(64)}`,
      media_type: "image/png",
      byte_size: 68,
    },
  };
}

test("preview loaded chart versions and pin the exact chart shown after Next", async ({ page }) => {
  const first = savedChart("a", "2026-11-20");
  const second = savedChart("b", "2026-11-21");
  const reference = {
    ...savedChart("c", "2026-11-22"),
    title: "Reference chart",
    availability: "reference_only",
    artifact: null,
  };
  const reads: string[] = [];
  const details: string[] = [];
  await page.route("**/api/evidence?*", (route) =>
    route.fulfill({ json: { items: [first, reference, second], total: 3 } }),
  );
  await page.route("**/api/artifacts/*/content", (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[3]!);
    reads.push(id);
    return route.fulfill({
      contentType: "image/png",
      body: id === first.artifact.id ? original : revised,
    });
  });
  await page.route("**/api/evidence/*", (route) => {
    details.push(route.request().url());
    return route.fulfill({ status: 404 });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const library = page.getByRole("region", { name: "Source library" });
  const packet = page.getByRole("list", { name: "Pinned material" });
  await library.getByRole("searchbox").fill("credit curve");
  await expect(library.getByRole("button", { name: "Pin 3 loaded results" })).toBeVisible();
  const firstPreview = library.getByRole("button", { name: /Preview chart.*2026-11-20/ });
  const secondPreview = library.getByRole("button", { name: /Preview chart.*2026-11-21/ });
  const firstOption = firstPreview.locator("..").getByRole("checkbox");
  const secondOption = secondPreview.locator("..").getByRole("checkbox");
  await expect(firstPreview).toBeVisible();
  await expect(secondPreview).toBeVisible();
  await expect(firstOption).not.toBeChecked();
  await expect(secondOption).not.toBeChecked();
  await expect(packet).toHaveCount(0);
  await expect(library.getByRole("button", { name: /Preview chart Reference chart/ })).toHaveCount(
    0,
  );
  expect(reads).toEqual([]);

  await firstPreview.press("Enter");
  const dialog = page.getByRole("dialog");
  const chart = dialog.getByRole("img", { name: first.title });
  await expect(dialog).toHaveAccessibleDescription(/Chart 1 of 2.*As of 2026-11-20/);
  await expect(chart).toHaveAttribute(
    "src",
    new URL(`/api/artifacts/${encodeURIComponent(first.artifact.id)}/content`, page.url()).href,
  );
  await expect.poll(() => reads).toEqual([first.artifact.id]);
  await dialog.getByRole("button", { name: "Next chart" }).click();
  await expect(dialog).toHaveAccessibleDescription(/Chart 2 of 2.*As of 2026-11-21/);
  await expect(chart).toHaveAttribute(
    "src",
    new URL(`/api/artifacts/${encodeURIComponent(second.artifact.id)}/content`, page.url()).href,
  );
  await expect.poll(() => reads).toEqual([first.artifact.id, second.artifact.id]);

  await dialog.getByRole("button", { name: "Pin this chart" }).click();
  await expect(dialog).toBeHidden();
  await expect(firstPreview).toBeFocused();
  await expect(firstOption).not.toBeChecked();
  await expect(secondOption).toBeChecked();
  await expect(packet.getByRole("listitem")).toHaveCount(1);
  await expect(packet.getByRole("link")).toHaveAttribute(
    "href",
    `/?view=evidence&evidence=${second.id}`,
  );
  await expect(library.getByRole("button", { name: "Pin 2 loaded results" })).toBeVisible();
  expect(details).toEqual([]);

  await secondPreview.click();
  await expect(dialog.getByRole("button", { name: "Chart pinned" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(secondPreview).toBeFocused();
  await expect(packet.getByRole("listitem")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel("Source files").setInputFiles({
    name: "queued-note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic note awaiting an explicit pin."),
  });
  await expect(firstPreview).toBeDisabled();
});

test("a full study packet still lets the owner inspect a chart", async ({ page }) => {
  function references(prefix: string) {
    return Array.from({ length: 50 }, (_, index) => ({
      id: crypto.randomUUID(),
      title: `${prefix} source ${index + 1}`,
      kind: "link",
      availability: "reference_only",
      representation: "original",
    }));
  }
  const first = references("First");
  const second = references("Second");
  const chart = savedChart("d", "2026-11-24");
  await page.route("**/api/evidence?*", (route) => {
    const query = new URL(route.request().url()).searchParams.get("search");
    const items =
      query === "first" ? first : query === "second" ? second : query === "curve" ? [chart] : [];
    return route.fulfill({ json: { items, total: items.length } });
  });
  await page.route("**/api/artifacts/*/content", (route) =>
    route.fulfill({ contentType: "image/png", body: original }),
  );
  await page.goto("/");
  const library = page.getByRole("region", { name: "Source library" });
  const search = library.getByRole("searchbox");
  const rows = page.getByRole("list", { name: "Pinned material" }).getByRole("listitem");
  await search.fill("first");
  await library.getByRole("button", { name: "Pin 50 loaded results" }).click();
  await expect(rows).toHaveCount(50);
  await search.fill("second");
  await library.getByRole("button", { name: "Pin 50 loaded results" }).click();
  await expect(rows).toHaveCount(100);
  await search.fill("curve");
  const preview = library.getByRole("button", { name: /Preview chart Recorded credit curve/ });
  await expect(preview).toBeEnabled();
  await preview.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("img", { name: chart.title })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Packet full" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(preview).toBeFocused();
  await expect(rows).toHaveCount(100);
});
