import { expect, test } from "./fixtures";
import { seed } from "./report-fixture";
import type { ReportRevision, ReportSection, ReportView } from "../src/lib/reports";

for (const width of [320, 390]) {
  test(`move an exact section across a long draft and save its order at ${width}px`, async ({
    page,
    request,
  }) => {
    const { record } = await seed(request, `position ${width} ${crypto.randomUUID().slice(0, 8)}`);
    const heading = "Liquidity outlook";
    const longHeading = "Refinancing and bank capacity ".repeat(7).trim();
    const sections: ReportSection[] = Array.from({ length: 40 }, (_, index) => ({
      id: crypto.randomUUID(),
      heading:
        index === 0 || index === 39 ? heading : index === 1 ? longHeading : `Scenario ${index + 1}`,
      body: index === 39 ? "Tail receipt to move." : `Synthetic section ${index + 1}.`,
      kind: "interpretation",
      citations: [],
      chart_ids: [],
    }));
    const created = await request.post("/api/reports/revisions", {
      data: {
        id: crypto.randomUUID(),
        base_revision_id: record.id,
        title: record.title,
        style_guide_id: record.style_guide_id,
        evidence_ids: record.sources.map(({ id }) => id),
        sections,
        change_note: "Seed a complete synthetic outline.",
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const report: ReportRevision = await created.json();
    const moving = sections[39]!;
    let writes = 0;
    page.on("request", (item) => {
      if (item.method() === "POST" && new URL(item.url()).pathname === "/api/reports/revisions")
        writes += 1;
    });
    await page.setViewportSize({ width, height: 740 });
    await page.goto(`/?view=reports&report=${report.id}`);

    const outline = page.getByRole("navigation", { name: "Report sections", exact: true });
    const filter = page.getByRole("searchbox", { name: "Find a section", exact: true });
    const sectionText = page.getByRole("textbox", { name: "Section text", exact: true });
    const position = page.getByRole("combobox", { name: "New position", exact: true });
    const move = page.getByRole("button", { name: "Move section", exact: true });
    const selected = (number: number) =>
      outline.getByRole("button", { name: `${number}. ${heading}`, exact: true });
    await filter.fill("TAIL RECEIPT");
    await expect(outline.getByRole("button")).toHaveCount(1);
    await selected(40).press("Enter");
    const unsaved = "Tail receipt with a new synthetic observation.";
    await sectionText.fill(unsaved);
    await expect(position).toBeHidden();
    await page.getByText("Move to position", { exact: true }).press("Enter");
    await expect(position).toHaveValue(moving.id);
    await expect(move).toBeDisabled();
    await expect(position.getByRole("option")).toHaveCount(40);

    await position.selectOption({ label: `2. Before ${longHeading}` });
    await expect(selected(40)).toHaveAttribute("aria-current", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await position.selectOption({ label: `1. Before ${heading}` });
    await move.press("Enter");
    await expect(move).toBeFocused();
    await expect(selected(1)).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("status").filter({ hasText: "moved to position 1" })).toHaveText(
      `${heading} moved to position 1 of 40.`,
    );

    await position.selectOption({ label: `39. After ${sections[37]!.heading}` });
    await move.click();
    await expect(selected(39)).toHaveAttribute("aria-current", "true");
    await page.getByRole("button", { name: "Move earlier", exact: true }).press("Enter");
    await expect(selected(38)).toHaveAttribute("aria-current", "true");
    await page.getByRole("button", { name: "Move later", exact: true }).press("Enter");
    await expect(selected(39)).toHaveAttribute("aria-current", "true");
    await expect(outline.getByRole("button")).toHaveCount(1);
    await expect(filter).toHaveValue("TAIL RECEIPT");
    await expect(sectionText).toHaveValue(unsaved);
    const savedBefore: ReportView = await (await request.get(`/api/reports/${report.id}`)).json();
    expect(savedBefore.current_revision_id).toBe(report.id);
    expect(savedBefore.revision.sections.map(({ id }) => id)).toEqual(sections.map(({ id }) => id));
    expect(writes).toBe(0);

    await page
      .getByRole("textbox", { name: "Revision change note", exact: true })
      .fill("Place the receipt with its related section.");
    await page.getByRole("button", { name: "Save report revision", exact: true }).click();
    await expect(
      page.getByText(`Saved revision ${report.version + 1}`, { exact: true }),
    ).toBeVisible();
    await expect(selected(39)).toHaveAttribute("aria-current", "true");
    await expect(sectionText).toHaveValue(unsaved);
    const savedId = new URL(page.url()).searchParams.get("report");
    const saved: ReportView = await (await request.get(`/api/reports/${savedId}`)).json();
    expect(saved.revision.sections.map(({ id }) => id)).toEqual(
      [...sections.slice(0, 38), moving, sections[38]!].map(({ id }) => id),
    );
    expect(saved.revision.sections[38]!.body).toBe(unsaved);

    await page.getByRole("button", { name: "Remove section", exact: true }).click();
    await expect(selected(1)).toHaveAttribute("aria-current", "true");
    await page.getByText("Move to position", { exact: true }).press("Enter");
    await position.selectOption({ label: `39. After ${sections[38]!.heading}` });
    await move.press("Enter");
    await expect(selected(39)).toHaveAttribute("aria-current", "true");
    await expect(sectionText).toHaveValue(sections[0]!.body);
    expect(writes).toBe(1);
  });
}
