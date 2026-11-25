import { expect, test } from "./fixtures";
import { seed } from "./report-fixture";
import { evidenceUrl, type EvidenceRecord } from "../src/lib/evidence";
import type { ReportRevision } from "../src/lib/reports";

const selectedText = "The selected capture contains a separate synthetic assumption.";

for (const width of [390, 1440]) {
  test(`inspect the selected source without leaving its reference draft at ${width}px`, async ({
    page,
    request,
  }) => {
    const tag = `inspect reference ${width} ${crypto.randomUUID().slice(0, 8)}`;
    const { record, source } = await seed(request, tag);
    const fillers = await Promise.all(
      Array.from({ length: 18 }, async (_, index) => {
        const result = await request.post("/api/evidence", {
          data: {
            id: crypto.randomUUID(),
            title: `Weekly reading ${index + 1} ${tag}`,
            kind: "link",
            rights: "unknown",
            source_url: `https://example.invalid/weekly/${index + 1}`,
            availability: "reference_only",
          },
        });
        expect(result.status(), await result.text()).toBe(201);
        return (await result.json()) as EvidenceRecord;
      }),
    );
    const selectedResponse = await request.post("/api/evidence", {
      data: {
        id: crypto.randomUUID(),
        title: source.title,
        kind: "text",
        rights: "owned",
        text: selectedText,
      },
    });
    expect(selectedResponse.status(), await selectedResponse.text()).toBe(201);
    const selected: EvidenceRecord = await selectedResponse.json();
    const saved = await request.post("/api/reports/revisions", {
      data: {
        id: crypto.randomUUID(),
        base_revision_id: record.id,
        title: record.title,
        style_guide_id: record.style_guide_id,
        evidence_ids: [...record.sources, ...fillers, selected].map(({ id }) => id),
        sections: record.sections,
        change_note: "Pin a synthetic reading list with two captured versions of one title.",
      },
    });
    expect(saved.status(), await saved.text()).toBe(201);
    const report: ReportRevision = await saved.json();
    const mutations: string[] = [];
    page.context().on("request", (entry) => {
      const path = new URL(entry.url()).pathname;
      if (entry.method() === "POST" && path.startsWith("/api/")) mutations.push(path);
    });

    await page.setViewportSize({ width, height: width === 390 ? 740 : 960 });
    const editorUrl = `/?view=reports&report=${report.id}`;
    await page.goto(editorUrl);
    await page.getByRole("button", { name: "Add source reference", exact: true }).click();
    const form = page.getByRole("group", { name: "New reference", exact: true });
    const selector = form.getByRole("combobox", { name: "Reference source", exact: true });
    const link = form.getByRole("link", { name: "Inspect selected source (new tab)", exact: true });
    await expect(selector.getByRole("option")).toHaveCount(21);
    await expect(selector.getByRole("option", { name: selected.title, exact: true })).toHaveCount(
      2,
    );
    await selector.selectOption(source.id);
    await expect(link).toHaveAttribute("href", evidenceUrl(source.id));
    await selector.selectOption(selected.id);
    await expect(link).toHaveAttribute("href", evidenceUrl(selected.id));
    await expect(link).toHaveAttribute("target", "_blank");
    const locator = form.getByRole("textbox", { name: "Source location", exact: true });
    const relation = form.getByRole("combobox", { name: "Evidence relationship", exact: true });
    const quote = form.getByRole("textbox", { name: "Exact quotation (optional)", exact: true });
    const rationale = form.getByRole("textbox", { name: "Why this source matters", exact: true });
    await relation.selectOption("contradicts");
    await locator.fill("Opening paragraph");
    await quote.fill(selectedText);
    await rationale.fill("Check the selected original before applying this reference.");
    const [inspection] = await Promise.all([
      page.waitForEvent("popup"),
      width === 390 ? link.click() : link.press("Enter"),
    ]);
    await expect(inspection).toHaveURL(evidenceUrl(selected.id));
    await expect(inspection.getByText(selectedText, { exact: true })).toBeVisible();
    await inspection.close();
    await expect(page).toHaveURL(editorUrl);
    await expect(selector).toHaveValue(selected.id);
    await expect(relation).toHaveValue("contradicts");
    await expect(locator).toHaveValue("Opening paragraph");
    await expect(quote).toHaveValue(selectedText);
    await expect(rationale).toHaveValue(
      "Check the selected original before applying this reference.",
    );
    await expect(page.getByRole("button", { name: "Save report revision" })).toBeDisabled();
    expect(mutations).toEqual([]);
  });
}
