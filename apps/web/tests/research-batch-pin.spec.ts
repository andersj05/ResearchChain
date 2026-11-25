import { expect, test } from "./fixtures";

function reference(title: string, date = "2026-11-20") {
  const id = crypto.randomUUID();
  return {
    id,
    title,
    kind: "link",
    availability: "reference_only",
    representation: "original",
    as_of_date: date,
    source_url: `https://example.org/reference-${id}`,
  };
}

test("pin the loaded search results in reading order and keep exact source versions", async ({
  page,
}) => {
  const first = reference("Macro tape", "2026-11-23");
  const existing = reference("Macro anchor");
  const second = reference("Macro tape", "2026-11-17");
  const later = reference("Macro inventory follow-up");
  const outside = reference("Unrelated library source");
  const detailReads: string[] = [];
  const searchOffsets: string[] = [];
  await page.route("**/api/evidence?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("search") !== "macro")
      return route.fulfill({ json: { items: [outside], total: 1 } });
    const offset = params.get("offset") ?? "0";
    searchOffsets.push(offset);
    return route.fulfill({
      json:
        offset === "0"
          ? { items: [first, existing, second], total: 4, next_offset: 3 }
          : { items: [later], total: 4 },
    });
  });
  await page.route("**/api/evidence/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    detailReads.push(id);
    return route.fulfill({
      json: [first, existing, second, later, outside].find((source) => source.id === id),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const library = page.getByRole("region", { name: "Source library" });
  const search = library.getByRole("searchbox", { name: "Search evidence library" });
  const packet = page.getByRole("list", { name: "Pinned material" });
  const links = packet.getByRole("link");
  await expect(library.getByRole("checkbox", { name: /Unrelated library source/ })).toBeVisible();
  await expect(library.getByRole("button", { name: /Pin .* loaded result/ })).toHaveCount(0);

  await search.fill("macro");
  await library.getByRole("checkbox", { name: /Macro anchor/ }).check();
  const batch = library.getByRole("button", { name: "Pin 2 loaded results" });
  await expect(batch).toHaveAccessibleDescription("3 of 4 results loaded.");
  await search.focus();
  await page.keyboard.press("Tab");
  await expect(library.getByRole("combobox", { name: "Source type" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(batch).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(links).toHaveCount(3);
  await expect(links.nth(0)).toHaveAttribute("href", `/?view=evidence&evidence=${existing.id}`);
  await expect(links.nth(1)).toHaveAttribute("href", `/?view=evidence&evidence=${first.id}`);
  await expect(links.nth(2)).toHaveAttribute("href", `/?view=evidence&evidence=${second.id}`);
  await expect(links.nth(1)).toContainText(first.as_of_date);
  await expect(links.nth(2)).toContainText(second.as_of_date);
  await expect(library.getByRole("button", { name: "Loaded results pinned" })).toBeFocused();
  await expect(packet).not.toContainText(later.title);

  await library.getByRole("button", { name: "Load more sources" }).click();
  await library.getByRole("button", { name: "Pin 1 loaded result", exact: true }).click();
  await expect(links).toHaveCount(4);
  await expect(links.last()).toHaveAttribute("href", `/?view=evidence&evidence=${later.id}`);
  expect(searchOffsets).toEqual(["0", "3"]);
  expect(detailReads).toEqual([]);
});

test("show the remaining packet capacity before adding a batch", async ({ page }) => {
  const first = Array.from({ length: 50 }, (_, index) => reference(`First batch ${index + 1}`));
  const second = Array.from({ length: 49 }, (_, index) => reference(`Second batch ${index + 1}`));
  const final = [reference("Final match 1"), reference("Final match 2")];
  await page.route("**/api/evidence?*", (route) => {
    const query = new URL(route.request().url()).searchParams.get("search");
    const items =
      query === "first" ? first : query === "second" ? second : query === "final" ? final : [];
    return route.fulfill({ json: { items, total: items.length } });
  });
  await page.goto("/");
  const library = page.getByRole("region", { name: "Source library" });
  const search = library.getByRole("searchbox", { name: "Search evidence library" });
  const rows = page.getByRole("list", { name: "Pinned material" }).getByRole("listitem");
  await search.fill("first");
  await library.getByRole("button", { name: "Pin 50 loaded results" }).click();
  await expect(rows).toHaveCount(50);
  await search.fill("second");
  await library.getByRole("button", { name: "Pin 49 loaded results" }).click();
  await expect(rows).toHaveCount(99);

  await search.fill("final");
  const finalBatch = library.getByRole("button", { name: "Pin 2 loaded results" });
  await expect(finalBatch).toBeDisabled();
  await expect(finalBatch).toHaveAccessibleDescription(
    "1 packet slot left. Narrow the search or pin sources individually.",
  );
  await finalBatch.press("Enter");
  await expect(rows).toHaveCount(99);
  await library.getByRole("checkbox", { name: /Final match 1/ }).check();
  await expect(rows).toHaveCount(100);
  await expect(library.getByRole("checkbox", { name: /Final match 2/ })).toBeDisabled();
  await expect(
    library.getByRole("button", { name: "Pin 1 loaded result", exact: true }),
  ).toBeDisabled();
});
