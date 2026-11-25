import { expect, test } from "./fixtures";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=",
  "base64",
);

function chart(date: string, digest: string, title = "Weekly curve") {
  return {
    id: crypto.randomUUID(),
    kind: "image",
    title,
    availability: "available",
    representation: "chart_screenshot",
    as_of_date: date,
    artifact: { id: `sha256:${digest.repeat(64)}`, media_type: "image/png" },
  };
}

test("filter saved sources on mobile and pin only the filtered results that have loaded", async ({
  page,
}) => {
  const note = {
    id: crypto.randomUUID(),
    kind: "text",
    title: "Weekly curve notes",
    availability: "reference_only",
    representation: "original",
  };
  const first = chart("2026-11-24", "a");
  const second = chart("2026-11-17", "b");
  const older = chart("2026-11-10", "c");
  const other = chart("2026-11-25", "d", "Unrelated chart");
  const sources = [note, other, first, second, older];
  const unfilteredPageStarted = Promise.withResolvers<void>();
  const releaseUnfilteredPage = Promise.withResolvers<void>();
  const unfilteredPageFinished = Promise.withResolvers<void>();
  const filteredOffsets: number[] = [];
  const originals: string[] = [];

  await page.route("**/api/evidence?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const kind = params.get("kind");
    const search = params.get("search") ?? "";
    const offset = Number(params.get("offset") ?? 0);
    const matching = sources.filter(
      (item) => (!kind || item.kind === kind) && item.title.toLowerCase().includes(search),
    );
    if (kind === "image" && search === "weekly") filteredOffsets.push(offset);
    const stalePage = !kind && search === "weekly" && offset > 0;
    if (stalePage) {
      unfilteredPageStarted.resolve();
      await releaseUnfilteredPage.promise;
    }
    await route.fulfill({
      json: {
        items: matching.slice(offset, offset + 2),
        total: matching.length,
        next_offset: offset + 2 < matching.length ? offset + 2 : null,
      },
    });
    if (stalePage) unfilteredPageFinished.resolve();
  });
  await page.route("**/api/artifacts/*/content", (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[3]!);
    originals.push(id);
    return route.fulfill({ contentType: "image/png", body: png });
  });

  try {
    await page.setViewportSize({ width: 320, height: 780 });
    await page.goto("/");
    const library = page.getByRole("region", { name: "Source library" });
    const search = library.getByRole("searchbox", { name: "Search evidence library" });
    const type = library.getByRole("combobox", { name: "Source type" });
    const noteOption = library.getByRole("checkbox", { name: note.title });
    const more = library.getByRole("button", { name: "Load more sources" });
    const batch = library.getByRole("button", { name: "Pin 2 loaded results" });
    const olderPreview = library.getByRole("button", { name: /Preview chart.*2026-11-10/ });
    const links = page.getByRole("list", { name: "Pinned material" }).getByRole("link");
    await expect(type).toHaveValue("");
    await noteOption.check();
    await search.fill("weekly");
    await expect(
      library.getByRole("button", { name: "Pin 1 loaded result", exact: true }),
    ).toBeVisible();
    await more.click();
    await unfilteredPageStarted.promise;

    await type.selectOption({ label: "Images and charts" });
    await expect(search).toHaveValue("weekly");
    await expect(noteOption).toHaveCount(0);
    await expect(batch).toHaveAccessibleDescription("2 of 3 results loaded.");
    releaseUnfilteredPage.resolve();
    await unfilteredPageFinished.promise;
    await expect(olderPreview).toHaveCount(0);
    expect(originals).toEqual([]);

    const preview = library.getByRole("button", { name: /Preview chart.*2026-11-24/ });
    await preview.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveAccessibleDescription(/Chart 1 of 2.*2026-11-24/);
    await dialog.getByRole("button", { name: "Next chart" }).click();
    await expect(dialog).toHaveAccessibleDescription(/Chart 2 of 2.*2026-11-17/);
    await expect(dialog.getByRole("img")).toHaveAttribute(
      "src",
      new URL(`/api/artifacts/${encodeURIComponent(second.artifact.id)}/content`, page.url()).href,
    );
    await expect.poll(() => originals).toEqual([first.artifact.id, second.artifact.id]);
    await page.keyboard.press("Escape");
    await expect(preview).toBeFocused();

    await batch.click();
    await expect(links).toHaveCount(3);
    await more.click();
    await library.getByRole("button", { name: "Pin 1 loaded result", exact: true }).click();
    await expect(links).toHaveCount(4);
    for (const [index, source] of [note, first, second, older].entries())
      await expect(links.nth(index)).toHaveAttribute(
        "href",
        `/?view=evidence&evidence=${source.id}`,
      );
    expect(filteredOffsets).toEqual([0, 2]);

    await type.selectOption({ label: "All types" });
    await expect(search).toHaveValue("weekly");
    await expect(noteOption).toBeChecked();
    await search.fill("");
    await expect(library.getByRole("checkbox", { name: other.title })).toBeVisible();
    await type.selectOption({ label: "Images and charts" });
    await expect(noteOption).toHaveCount(0);
    await expect(
      library.getByRole("button", { name: "Pin 1 loaded result", exact: true }),
    ).toBeVisible();
    await expect(links).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    releaseUnfilteredPage.resolve();
  }
});
