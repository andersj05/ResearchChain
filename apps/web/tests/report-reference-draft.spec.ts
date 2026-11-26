import { expect, test } from "./fixtures";
import { seed } from "./report-fixture";
import type { EvidenceRecord } from "../src/lib/evidence";
import type { ReportRevision, ReportSection, ReportView } from "../src/lib/reports";

const heading = "Liquidity outlook";
const locatorText = "Opening notes, sentence 1";
const quoteText = "An exact synthetic quotation.";
const rationaleText = "This qualifies the draft's opening comparison.";

for (const width of [390, 1440]) {
  test(`keeps unfinished references with their exact section at ${width}px`, async ({
    page,
    request,
    ownerSession,
  }) => {
    const tag = `reference ${width} ${crypto.randomUUID().slice(0, 8)}`;
    const { record, source } = await seed(request, tag);
    const link = await request.post("/api/evidence", {
      data: {
        id: crypto.randomUUID(),
        title: `Uncaptured background reference ${tag}`,
        kind: "link",
        rights: "unknown",
        source_url: "https://example.invalid/background",
        availability: "reference_only",
      },
    });
    expect(link.status(), await link.text()).toBe(201);
    const metadata: EvidenceRecord = await link.json();
    const sections: ReportSection[] = [
      "Opening comparison for privately captured research.",
      "Separate assumptions for the conditional scenario.",
    ].map((body) => ({
      id: crypto.randomUUID(),
      heading,
      body,
      kind: "interpretation",
      citations: [],
      chart_ids: [],
    }));
    const scenarioReference = {
      evidence_id: source.id,
      basis: "source_text",
      relation: "supports",
      locator: "Scenario notes, first line",
      quote: quoteText,
      rationale: "This is the saved rationale for the second section.",
    } as const;
    sections[1]!.citations = [scenarioReference];
    const result = await request.post("/api/reports/revisions", {
      data: {
        id: crypto.randomUUID(),
        base_revision_id: record.id,
        title: record.title,
        style_guide_id: record.style_guide_id,
        evidence_ids: [...record.sources.map(({ id }) => id), metadata.id],
        sections,
        change_note: "Create two independently identified synthetic sections.",
      },
    });
    expect(result.status(), await result.text()).toBe(201);
    const report: ReportRevision = await result.json();
    const mutations: string[] = [];
    page.on("request", (entry) => {
      const path = new URL(entry.url()).pathname;
      if (entry.method() === "POST" && path.startsWith("/api/")) mutations.push(path);
    });

    await page.setViewportSize({ width, height: width === 390 ? 740 : 960 });
    await page.goto(`/?view=reports&report=${report.id}`);
    const outline = page.getByRole("navigation", { name: "Report sections" });
    const opening = outline.getByRole("button", { name: `1. ${heading}`, exact: true });
    const scenario = outline.getByRole("button", { name: `2. ${heading}`, exact: true });
    const sectionText = page.getByRole("textbox", { name: "Section text", exact: true });
    const add = page.getByRole("button", { name: "Add source reference", exact: true });
    const apply = page.getByRole("button", { name: "Apply reference to draft", exact: true });
    const edit = page.getByRole("button", { name: "Edit reference 1", exact: true });
    const cancel = page.getByRole("button", { name: "Cancel reference", exact: true });
    const save = page.getByRole("button", { name: "Save report revision", exact: true });
    const referenceSource = page.getByRole("combobox", { name: "Reference source", exact: true });
    const relation = page.getByRole("combobox", { name: "Evidence relationship", exact: true });
    const locator = page.getByRole("textbox", { name: "Source location", exact: true });
    const quote = page.getByRole("textbox", { name: "Exact quotation (optional)", exact: true });
    const rationale = page.getByRole("textbox", { name: "Why this source matters", exact: true });
    await add.press("Enter");
    await referenceSource.selectOption(source.id);
    await relation.selectOption("contradicts");
    await apply.press("Enter");
    const validation = page.getByRole("alert").filter({
      hasText: "Add a location and explain why this source matters.",
    });
    await expect(validation).toBeVisible();
    await locator.fill(locatorText);
    await quote.fill(quoteText);
    await rationale.fill(rationaleText);
    await expect(save).toBeDisabled();
    const storageKey = `${ownerSession.prefix}.report.draft.${report.id}`;
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();
    await scenario.click();
    await expect(sectionText).toHaveValue(sections[1]!.body);
    await expect(locator).toHaveCount(0);
    await expect(validation).toHaveCount(0);
    await edit.press("Enter");
    await expect(locator).toHaveValue(scenarioReference.locator);
    await locator.fill("Scenario draft, second line");
    await quote.fill("This is not market evidence.");
    await rationale.fill("Unapplied scenario rationale.");

    await opening.press("Enter");
    await expect(sectionText).toHaveValue(sections[0]!.body);
    await expect(page.getByRole("group", { name: "New reference", exact: true })).toBeVisible();
    await expect(referenceSource).toHaveValue(source.id);
    await expect(relation).toHaveValue("contradicts");
    await expect(locator).toHaveValue(locatorText);
    await expect(quote).toHaveValue(quoteText);
    await expect(rationale).toHaveValue(rationaleText);
    await expect(validation).toBeVisible();
    await expect(save).toBeDisabled();
    await apply.press("Enter");
    await expect(locator).toHaveCount(0);
    await expect(page.getByText(rationaleText, { exact: true })).toBeVisible();
    await expect(save).toBeEnabled();

    await scenario.press("Enter");
    await expect(page.getByRole("group", { name: "Edit reference", exact: true })).toBeVisible();
    await expect(locator).toHaveValue("Scenario draft, second line");
    await expect(quote).toHaveValue("This is not market evidence.");
    await expect(rationale).toHaveValue("Unapplied scenario rationale.");
    await expect(page.getByText(rationaleText, { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Remove section", exact: true }).click();
    await expect(sectionText).toHaveValue(sections[0]!.body);
    await page.getByRole("button", { name: "Restore removed section", exact: true }).click();
    await expect(locator).toHaveValue("Scenario draft, second line");
    await referenceSource.selectOption(metadata.id);
    await expect(page.getByText("Basis: metadata only", { exact: true })).toBeVisible();
    await expect(relation).toHaveValue("context");
    await expect(relation).toBeDisabled();
    await expect(locator).toBeEmpty();
    await expect(quote).toHaveCount(0);
    await expect(rationale).toBeEmpty();
    await cancel.press("Enter");
    await expect(locator).toHaveCount(0);
    await edit.press("Enter");
    await expect(locator).toHaveValue(scenarioReference.locator);
    await expect(quote).toHaveValue(quoteText);
    await expect(rationale).toHaveValue(scenarioReference.rationale);
    await cancel.click();
    await opening.click();
    await expect(add).toBeVisible();
    await expect(page.getByText(rationaleText, { exact: true })).toBeVisible();
    expect(mutations).toEqual([]);
    const saved: ReportView = await (await request.get(`/api/reports/${report.id}`)).json();
    expect(saved.current_revision_id).toBe(report.id);
    expect(saved.revision.sections[0]!.citations).toEqual([]);
    expect(saved.revision.sections[1]!.citations).toEqual([scenarioReference]);
    expect(saved.review_status).toBe("unreviewed");
  });
}
