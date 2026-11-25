import { expect, test } from "./fixtures";

function source(title: string, kind: string, availability = "available") {
  return {
    id: crypto.randomUUID(),
    title,
    kind,
    availability,
    representation: "original",
    publisher: "Synthetic research archive",
  };
}

for (const width of [320, 390, 1440]) {
  test(`combine Workbench source filters and preserve an exact source at ${width}px`, async ({
    page,
  }) => {
    const notes = source("Weekly curve notes", "text");
    const monthly = source("Monthly rate chart", "image");
    const dataset = source("Weekly curve dataset", "dataset");
    const charts = [
      "Weekly curve chart newest",
      "Weekly curve chart earlier",
      "Weekly curve chart oldest",
    ].map((title) => source(title, "image"));
    const linked = source("Weekly curve linked image", "image", "reference_only");
    const archived = {
      ...source("Archived yield reference", "link", "reference_only"),
      source_url: "https://example.test/pinned-yield",
      as_of_date: "2025-09-03",
    };
    const entries = [notes, monthly, dataset, ...charts, linked, archived];
    const listing: {
      search: string;
      availability: string | null;
      kind: string | null;
      offset: number;
    }[] = [];
    const opened: string[] = [];
    const olderPageRequested = Promise.withResolvers<void>();
    const olderPageReleased = Promise.withResolvers<void>();
    const olderPageServed = Promise.withResolvers<void>();
    let holdingOlderPage = true;
    await page.route("**/api/evidence?*", async (route) => {
      const params = new URL(route.request().url()).searchParams;
      const search = params.get("search") ?? "";
      const availability = params.get("availability");
      const kind = params.get("kind");
      const offset = Number(params.get("offset") ?? 0);
      listing.push({ search, availability, kind, offset });
      const matching = entries.filter(
        (record) =>
          (!kind || record.kind === kind) &&
          (!availability || record.availability === availability) &&
          record.title.toLowerCase().includes(search.toLowerCase()),
      );
      const delayed = holdingOlderPage && kind === "image" && offset === 2;
      if (delayed) {
        holdingOlderPage = false;
        olderPageRequested.resolve();
        await olderPageReleased.promise;
      }
      await route.fulfill({
        json: {
          items: matching.slice(offset, offset + 2),
          total: matching.length,
          next_offset: offset + 2 < matching.length ? offset + 2 : null,
        },
      });
      if (delayed) olderPageServed.resolve();
    });
    await page.route("**/api/evidence/*", (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-1);
      const selected = entries.find((record) => record.id === id);
      if (!selected) return route.fulfill({ status: 404 });
      opened.push(selected.id);
      return route.fulfill({ json: selected });
    });

    try {
      await page.setViewportSize({ width, height: 844 });
      const archiveUrl = `/?view=evidence&evidence=${archived.id}`;
      await page.goto(archiveUrl);
      const list = page.getByRole("complementary", { name: "Sources", exact: true });
      const detail = page.getByRole("article", { name: "Source inspection", exact: true });
      const search = list.getByRole("searchbox", { name: "Find a source", exact: true });
      const type = list.getByRole("combobox", { name: "Source type", exact: true });
      const availability = list.getByRole("combobox", { name: "Availability", exact: true });
      const more = list.getByRole("button", { name: "Load more sources", exact: true });
      const clear = list.getByRole("button", { name: "Clear filters", exact: true });
      const row = (title: string) => list.getByRole("button", { name: new RegExp(`^${title}`) });
      await expect(type).toHaveValue("");
      await expect(availability).toHaveValue("all");
      await expect(clear).toHaveCount(0);
      await expect(
        detail.getByRole("heading", { name: archived.title, exact: true }),
      ).toBeVisible();
      await expect(detail).toContainText(archived.as_of_date);
      expect(opened).toEqual([archived.id]);
      expect(listing).toEqual([{ search: "", availability: null, kind: null, offset: 0 }]);

      await search.fill("weekly");
      await availability.selectOption("available");
      await type.selectOption({ label: "Images and charts" });
      const scope = { search: "weekly", availability: "available", kind: "image" };
      await expect(list.getByText("2 of 3 matches loaded", { exact: true })).toBeVisible();
      expect(listing.at(-1)).toEqual({ ...scope, offset: 0 });
      await expect(row(charts[0]!.title)).toBeVisible();
      await expect(row(linked.title)).toHaveCount(0);
      await expect(row(notes.title)).toHaveCount(0);
      await expect(row(monthly.title)).toHaveCount(0);
      await expect(
        detail.getByRole("heading", { name: archived.title, exact: true }),
      ).toBeVisible();
      await expect(page).toHaveURL(archiveUrl);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );

      await more.click();
      await olderPageRequested.promise;
      expect(listing.at(-1)).toEqual({ ...scope, offset: 2 });
      await type.selectOption({ label: "Datasets" });
      await expect(row(dataset.title)).toBeVisible();
      expect(listing.at(-1)).toEqual({ ...scope, kind: "dataset", offset: 0 });
      olderPageReleased.resolve();
      await olderPageServed.promise;
      await expect(row(charts[2]!.title)).toHaveCount(0);
      await expect(search).toHaveValue("weekly");
      await expect(availability).toHaveValue("available");

      await type.selectOption({ label: "Images and charts" });
      await expect(list.getByText("2 of 3 matches loaded", { exact: true })).toBeVisible();
      expect(listing.at(-1)).toEqual({ ...scope, offset: 0 });
      await expect(row(charts[2]!.title)).toHaveCount(0);
      await more.click();
      await expect(row(charts[2]!.title)).toBeVisible();
      expect(listing.at(-1)).toEqual({ ...scope, offset: 2 });
      await expect(list.getByText("3 of 3 matches loaded", { exact: true })).toBeVisible();

      await type.selectOption({ label: "All types" });
      await expect(row(notes.title)).toBeVisible();
      expect(listing.at(-1)).toEqual({ ...scope, kind: null, offset: 0 });
      await expect(search).toHaveValue("weekly");
      await expect(availability).toHaveValue("available");

      const requestsBeforeClear = listing.length;
      await clear.press("Enter");
      await expect(search).toBeFocused();
      await expect(search).toHaveValue("");
      await expect(type).toHaveValue("");
      await expect(availability).toHaveValue("all");
      await expect(clear).toHaveCount(0);
      await expect(row(monthly.title)).toBeVisible();
      await expect(row(archived.title)).toHaveAttribute("aria-pressed", "true");
      await expect(page).toHaveURL(archiveUrl);
      expect(listing).toHaveLength(requestsBeforeClear);

      await more.click();
      await row(dataset.title).click();
      await expect(detail.getByRole("heading", { name: dataset.title, exact: true })).toBeVisible();
      await expect(page).toHaveURL(`/?view=evidence&evidence=${dataset.id}`);
      expect(listing.at(-1)).toEqual({ search: "", availability: null, kind: null, offset: 2 });

      if (width === 1440) {
        await page.getByRole("tab", { name: "Build", exact: true }).click();
        await page.getByRole("button", { name: "Run workflow", exact: true }).click();
        const setup = page.getByRole("dialog");
        const pickerSearch = setup.getByRole("searchbox", { name: "Search evidence library" });
        await expect(setup.getByRole("combobox", { name: "Source type" })).toHaveCount(0);
        await pickerSearch.fill("monthly");
        await expect(
          setup.getByRole("checkbox", { name: `${monthly.title} Captured` }),
        ).toBeVisible();
        expect(listing.at(-1)).toEqual({
          search: "monthly",
          availability: null,
          kind: null,
          offset: 0,
        });
      }
    } finally {
      olderPageReleased.resolve();
    }
  });
}
