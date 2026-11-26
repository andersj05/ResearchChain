import type { EvidenceKind, EvidenceRecord } from "../src/lib/evidence";
import { expect, test, type Page } from "./fixtures";

const topic = "Credit curves";

function source(title: string, kind: EvidenceKind, availability: EvidenceRecord["availability"]) {
  const id = crypto.randomUUID();
  return {
    id,
    title,
    kind,
    availability,
    representation: "original",
    rights: availability === "available" ? "owned" : "unknown",
    artifact:
      availability === "available"
        ? { id: `sha256:${id.replaceAll("-", "").repeat(2)}`, media_type: "text/plain" }
        : undefined,
  };
}

async function savedSources(page: Page) {
  const unavailable = Array.from({ length: 108 }, (_, index) =>
    source(`${topic} reference ${index + 1}`, "report", index % 2 ? "paywalled" : "reference_only"),
  );
  const captured = ["Quarterly observations", "Funding spreads", "Prior period"].map((name) =>
    source(`${topic} · ${name}`, "report", "available"),
  );
  const otherType = source(`${topic} · Analyst note`, "text", "available");
  const otherTopic = source("Liquidity calendar", "report", "available");
  const sources = [...unavailable, ...captured, otherType, otherTopic];
  const reads: {
    search: string;
    kind: string | null;
    availability: string | null;
    offset: number;
  }[] = [];
  const previousPageStarted = Promise.withResolvers<void>();
  const releasePreviousPage = Promise.withResolvers<void>();
  const previousPageFinished = Promise.withResolvers<void>();
  const writes: string[] = [];
  await page.route(/\/api\/(evidence|research-sessions)$/, (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.fallback();
    writes.push(new URL(request.url()).pathname);
    return route.abort();
  });
  await page.route("**/api/evidence?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const query = {
      search: params.get("search") ?? "",
      kind: params.get("kind"),
      availability: params.get("availability"),
      offset: Number(params.get("offset") ?? 0),
    };
    reads.push(query);
    const stalePage =
      query.search === topic && query.kind === "report" && !query.availability && query.offset > 0;
    if (stalePage) {
      previousPageStarted.resolve();
      await releasePreviousPage.promise;
    }
    const limit = Number(params.get("limit"));
    const matches = sources.filter(
      (item) =>
        item.title.toLowerCase().includes(query.search.toLowerCase()) &&
        (!query.kind || item.kind === query.kind) &&
        (!query.availability || item.availability === query.availability),
    );
    await route.fulfill({
      json: {
        items: matches.slice(query.offset, query.offset + limit),
        total: matches.length,
        next_offset: query.offset + limit < matches.length ? query.offset + limit : null,
      },
    });
    if (stalePage) previousPageFinished.resolve();
  });
  const library = page.getByRole("region", { name: "Source library" });
  return {
    reads,
    unavailable,
    captured,
    otherType,
    otherTopic,
    writes,
    previousPageStarted: previousPageStarted.promise,
    releasePreviousPage: releasePreviousPage.resolve,
    previousPageFinished: previousPageFinished.promise,
    library,
    search: library.getByRole("searchbox", { name: "Search evidence library" }),
    type: library.getByRole("combobox", { name: "Source type" }),
    availability: library.getByRole("combobox", { name: "Availability" }),
    more: library.getByRole("button", { name: "Load more sources" }),
    option: (item: (typeof sources)[number]) =>
      library.getByRole("checkbox", {
        name: new RegExp(`^${item.title} *(?:Captured|Link only|Paywalled)$`),
      }),
  };
}

for (const width of [320, 1440]) {
  test(`select captured reports before pagination and keep existing pins at ${width}px`, async ({
    page,
  }) => {
    const fixture = await savedSources(page);
    const reference = fixture.unavailable[0]!;
    const paywalled = fixture.unavailable[1]!;
    const pinned = page.getByRole("list", { name: "Pinned material" }).getByRole("link");
    const firstCaptured = fixture.option(fixture.captured[0]!);
    const options = fixture.library.getByRole("checkbox");

    try {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/");
      await expect(fixture.availability).toHaveValue("");
      await expect(fixture.option(paywalled)).toBeVisible();
      await fixture.option(reference).check();
      await expect(pinned).toHaveCount(1);

      await fixture.search.fill(topic);
      await fixture.type.selectOption("report");
      await expect(options).toHaveCount(50);
      await expect(firstCaptured).toHaveCount(0);
      await fixture.more.click();
      await fixture.previousPageStarted;

      await fixture.availability.selectOption({ label: "Captured" });
      await expect(fixture.search).toHaveValue(topic);
      await expect(fixture.type).toHaveValue("report");
      await expect(firstCaptured).toBeVisible();
      await expect(options).toHaveCount(3);
      await expect(fixture.more).toHaveCount(0);
      await expect(fixture.option(reference)).toHaveCount(0);
      await expect(fixture.option(fixture.otherType)).toHaveCount(0);
      await expect(fixture.option(fixture.otherTopic)).toHaveCount(0);
      fixture.releasePreviousPage();
      await fixture.previousPageFinished;
      expect(fixture.reads.filter((read) => read.availability === "available")).toEqual([
        { search: topic, kind: "report", availability: "available", offset: 0 },
      ]);

      await fixture.library.getByRole("button", { name: "Pin 3 loaded results" }).click();
      await expect(pinned).toHaveCount(4);
      for (const [index, item] of [reference, ...fixture.captured].entries())
        await expect(pinned.nth(index)).toHaveAttribute(
          "href",
          `/?view=evidence&evidence=${item.id}`,
        );

      await fixture.availability.selectOption({ label: "Link only" });
      await expect(fixture.option(reference)).toBeChecked();
      await expect(fixture.option(paywalled)).toHaveCount(0);
      await expect(pinned).toHaveCount(4);
      await fixture.availability.selectOption({ label: "All sources" });
      await expect(fixture.option(reference)).toBeChecked();
      await expect(fixture.option(paywalled)).toBeVisible();
      await expect(fixture.more).toBeVisible();
      expect(fixture.writes).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    } finally {
      fixture.releasePreviousPage();
    }
  });
}
