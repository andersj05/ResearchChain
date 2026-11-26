import { expect, test, type Locator } from "./fixtures";

function sourceScroll(list: Locator, compact: boolean) {
  return list.evaluate(
    (node, compactLayout) => ({
      list: Math.round(node.scrollTop),
      reader: Math.round(
        compactLayout ? window.scrollY : node.closest(".evidence-view")!.scrollTop,
      ),
    }),
    compact,
  );
}

for (const width of [390, 1440]) {
  test(`keeps Sources context and an unfinished form through Reports at ${width}px`, async ({
    page,
  }) => {
    const records = Array.from({ length: 54 }, (_, index) => ({
      id: crypto.randomUUID(),
      title: `Market fixture ${index + 1}`,
      kind: "text",
      availability: "available",
      representation: "original",
      rights: "owned",
      author: "Synthetic source author",
      notes: index === 53 ? "Synthetic provenance for this source. ".repeat(250) : "",
    }));
    const target = records[53]!;
    const reads: URLSearchParams[] = [];
    let claimReads = 0;
    const writes: string[] = [];
    await page.route("**/api/evidence?*", (route) => {
      const params = new URL(route.request().url()).searchParams;
      reads.push(params);
      const offset = Number(params.get("offset") ?? 0);
      const matching = records.filter(
        (source) =>
          source.title.toLowerCase().includes((params.get("search") ?? "").toLowerCase()) &&
          (!params.has("availability") || source.availability === params.get("availability")) &&
          (!params.has("kind") || source.kind === params.get("kind")),
      );
      return route.fulfill({
        json: {
          items: matching.slice(offset, offset + 50),
          total: matching.length,
          next_offset: offset + 50 < matching.length ? offset + 50 : null,
        },
      });
    });
    await page.route("**/api/evidence/*", (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-1);
      const source = records.find((item) => item.id === id);
      return source ? route.fulfill({ json: source }) : route.fulfill({ status: 404 });
    });
    await page.route("**/api/claims?*", (route) => {
      claimReads += 1;
      return route.fulfill({ json: { items: [], total: 0, next_offset: null } });
    });
    page.on("request", (entry) => {
      const { pathname } = new URL(entry.url());
      if (
        entry.method() !== "GET" &&
        ["/api/evidence", "/api/artifacts", "/api/claims"].includes(pathname)
      )
        writes.push(pathname);
    });
    const compact = width === 390;
    await page.setViewportSize({ width, height: compact ? 640 : 960 });
    await page.goto("/?view=workflow");
    await expect(page.getByRole("button", { name: "Run workflow", exact: true })).toBeEnabled();
    expect(reads).toEqual([]);
    expect(claimReads).toBe(0);

    const sources = page.getByRole("tab", { name: "Sources", exact: true });
    const reports = page.getByRole("tab", { name: "Reports", exact: true });
    await sources.click();
    const list = page.getByRole("complementary", { name: "Sources", exact: true });
    const find = list.getByRole("searchbox", { name: "Find a source" });
    const availability = list.getByRole("combobox", { name: "Availability" });
    const type = list.getByRole("combobox", { name: "Source type" });
    await find.fill("Market");
    await availability.selectOption("available");
    await type.selectOption("text");
    await list.getByRole("button", { name: "Load more sources" }).click();
    const result = list.getByRole("button", { name: new RegExp(target.title) });
    await result.scrollIntoViewIfNeeded();
    await result.press("Enter");
    const inspected = page.getByRole("heading", { name: target.title, exact: true });
    await expect(inspected).toBeVisible();
    await list.evaluate((node, compactLayout) => {
      if (compactLayout) window.scrollTo(0, 200);
      else node.closest(".evidence-view")!.scrollTo(0, 200);
    }, compact);
    const before = await sourceScroll(list, compact);
    expect(before.list).toBeGreaterThan(0);
    expect(before.reader).toBeGreaterThan(0);
    const readsBeforeVisit = reads.length;
    const claimReadsBeforeVisit = claimReads;
    if (compact) {
      await reports.evaluate((tab) => tab.focus({ preventScroll: true }));
      await page.keyboard.press("Enter");
    } else {
      await reports.click();
    }
    await expect(list).toBeHidden();
    await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
    expect(reads).toHaveLength(readsBeforeVisit);
    expect(claimReads).toBe(claimReadsBeforeVisit);
    records[0] = { ...records[0]!, id: crypto.randomUUID(), title: "Market fixture updated" };
    await sources.click();
    await expect(inspected).toBeVisible();
    await expect(find).toHaveValue("Market");
    await expect(availability).toHaveValue("available");
    await expect(type).toHaveValue("text");
    await expect(list.getByRole("button", { name: /Market fixture updated/ })).toBeVisible();
    await expect(result).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(new RegExp(`evidence=${target.id}`));
    const after = await sourceScroll(list, compact);
    expect(Math.abs(after.list - before.list)).toBeLessThanOrEqual(3);
    expect(Math.abs(after.reader - before.reader)).toBeLessThanOrEqual(3);
    expect(claimReads).toBeGreaterThan(claimReadsBeforeVisit);
    expect(
      reads.slice(readsBeforeVisit).some((params) => {
        return params.get("search") === "Market" && params.get("offset") === "50";
      }),
    ).toBe(true);
    if (compact) {
      await page.getByRole("button", { name: "Back to source results" }).press("Enter");
      await expect(result).toBeFocused();
    }

    await page.getByRole("button", { name: "Add source", exact: true }).click();
    const form = page.getByRole("region", { name: "Source form" });
    const title = form.getByLabel("Source title");
    const capture = form.getByRole("combobox", { name: "Capture" });
    const content = form.getByLabel("Source text or CSV/TSV");
    await title.fill("Synthetic unfinished title");
    await capture.selectOption("text");
    await content.fill("Synthetic unfinished source text.");
    await reports.click();
    await expect(form).toBeHidden();
    await sources.click();
    await expect(title).toHaveValue("Synthetic unfinished title");
    await expect(capture).toHaveValue("text");
    await expect(content).toHaveValue("Synthetic unfinished source text.");
    expect(writes).toEqual([]);
  });
}
