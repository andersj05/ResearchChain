import { expect, test } from "./fixtures";
import { styleBody } from "./report-fixture";
import type { EvidenceRecord } from "../src/lib/evidence";
import type {
  ReportRevision,
  ReportSection,
  ReportSummary,
  ReportView,
  StyleGuide,
} from "../src/lib/reports";

const hash = "a".repeat(64);
const now = "2026-11-25T11:00:00.000Z";
const revisionCount = 24;
const pastVersion = 4;
const draftText = "Draft maturity schedule. ".repeat(150);

for (const width of [390, 1440]) {
  test(`open exact report history while keeping the active draft at ${width}px`, async ({
    page,
  }) => {
    const seriesId = crypto.randomUUID();
    const idAt = Array.from({ length: revisionCount }, () => crypto.randomUUID());
    const headId = idAt.at(-1)!;
    const pastId = idAt[pastVersion - 1]!;
    const sectionIds = Array.from({ length: 12 }, () => crypto.randomUUID());
    const sourceId = crypto.randomUUID();
    const guideBody = styleBody("twenty-four revisions");
    const guide: StyleGuide = {
      ...guideBody,
      examples: guideBody.examples.map((example) => ({
        ...example,
        kind: example.kind === "structure" ? "structure" : "voice",
      })),
      series_id: crypto.randomUUID(),
      version: 1,
      content_hash: hash,
      created_at: now,
      use_scope: "editorial_development",
    };
    const source: EvidenceRecord = {
      id: sourceId,
      title: "Synthetic reading",
      kind: "text",
      representation: "original",
      availability: "available",
      author: "Synthetic author",
      publisher: "",
      rights: "owned",
      rights_note: "",
      method: "",
      units: "",
      uncertainty: "",
      notes: "",
      created_at: now,
      capture_method: "user_text",
      untrusted: true,
      artifact: {
        id: crypto.randomUUID(),
        media_type: "text/plain",
        name: "synthetic-source.txt",
        byte_size: 24,
        created_at: now,
      },
    };
    const summary: ReportSummary[] = idAt.map((id, index) => ({
      id,
      series_id: seriesId,
      version: index + 1,
      title: "Synthetic report revision history",
      created_at: new Date(Date.parse(now) + index * 3600000).toISOString(),
      author: index === 0 ? "research_seed" : "human",
      change_note:
        index === pastVersion - 1
          ? "Reorganize the original refinance discussion."
          : `Synthetic revision note ${index + 1}.`,
    }));
    const history = [...summary].reverse();
    const provenance: ReportRevision["provenance"] = {
      run_id: crypto.randomUUID(),
      workflow_hash: hash,
      brief: "Synthetic history read fixture",
      renderer: "report-seed-1",
      manifest: {
        version: "research-manifest-1",
        settings: { provider: "chatgpt_plan", model: "synthetic", billing: "included_plan" },
        account_id: "synthetic",
        account_label: "Synthetic",
        workflow_revision_id: crypto.randomUUID(),
        compiler_version: "research-0.3.0",
        prompt_versions: {},
        prompt_hashes: {},
        tool_config: {},
        evidence: [],
        created_at: now,
      },
      attempt: {
        id: crypto.randomUUID(),
        path: "fixture",
        stage: "custom",
        model: "synthetic",
        status: "completed",
        input_bytes: 0,
        output_characters: 0,
        created_at: now,
      },
    };
    function reportView(index: number): ReportView {
      const entry = summary[index]!;
      const sections: ReportSection[] = sectionIds.map((id, section) => ({
        id,
        heading:
          section === 11
            ? "Maturity schedule"
            : section === 0
              ? "Market context"
              : `Analysis section ${section + 1}`,
        kind: "interpretation",
        body: `Saved section ${section + 1} at revision ${entry.version}.`,
        citations: [],
        chart_ids: [],
      }));
      return {
        revision: {
          ...entry,
          replaces_id: idAt[index - 1] ?? null,
          style_guide_id: guide.id,
          sections,
          sources: [source],
          provenance,
          content_hash: entry.version.toString(16).padStart(64, "0"),
          section_hashes: Object.fromEntries(sectionIds.map((id) => [id, hash])),
          edits: [],
        },
        current_revision_id: headId,
        style_guide: guide,
        source_bases: { [sourceId]: "source_text" },
        feedback: [],
        review_status: "unreviewed",
      };
    }
    const context = page.context();
    await context.route("**/api/style-guides", (route) => route.fulfill({ json: [guide] }));
    await context.route(`**/api/evidence/${sourceId}`, (route) => route.fulfill({ json: source }));
    await context.route("**/api/reports", (route) => route.fulfill({ json: [history[0]] }));
    await context.route("**/api/reports/*/history", (route) => route.fulfill({ json: history }));
    await context.route("**/api/reports/*", (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
      const index = idAt.indexOf(id);
      return index < 0
        ? route.fulfill({ status: 404 })
        : route.fulfill({ json: reportView(index) });
    });
    const writes: string[] = [];
    context.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() === "POST" && path.startsWith("/api/")) writes.push(path);
    });

    await page.setViewportSize({ width, height: width === 390 ? 740 : 960 });
    const headUrl = `/?view=reports&report=${headId}`;
    const pastUrl = `/?view=reports&report=${pastId}`;
    const pastText = `Saved section 1 at revision ${pastVersion}.`;
    await page.goto(headUrl);
    const editor = page.getByRole("region", { name: "Report editor", exact: true });
    const heading = editor.getByRole("heading", { name: history[0]!.title, exact: true });
    const filter = editor.getByRole("searchbox", { name: "Find a section", exact: true });
    const outline = editor.getByRole("navigation", { name: "Report sections", exact: true });
    const sectionText = editor.getByRole("textbox", { name: "Section text", exact: true });
    const maturity = outline.getByRole("button", { name: "12. Maturity schedule", exact: true });
    const historyHeader = editor.getByText("Revision history", { exact: true });
    const pastLabel = new RegExp(`^Revision ${pastVersion} · Human`);
    const latest = editor.getByRole("button", { name: "Open latest revision", exact: true });
    await expect(heading).toBeVisible();
    await expect(heading).not.toBeFocused();
    await historyHeader.click();
    await expect(editor.getByRole("button", { name: /^Revision \d+ ·/ })).toHaveCount(
      revisionCount,
    );
    const pastRow = editor.getByRole("button", { name: pastLabel });
    await pastRow.scrollIntoViewIfNeeded();
    await expect(heading).not.toBeInViewport();
    await pastRow.press("Enter");
    await expect(page).toHaveURL(pastUrl);
    await expect(sectionText).toHaveValue(pastText);
    await expect(sectionText).toBeDisabled();
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport({ ratio: 1 });
    await latest.click();
    await expect(page).toHaveURL(headUrl);
    await expect(sectionText).toBeEnabled();

    await filter.fill("Maturity");
    await maturity.press("Enter");
    await editor.getByRole("button", { name: "Add source reference", exact: true }).click();
    const reference = editor.getByRole("group", { name: "New reference", exact: true });
    const locator = reference.getByRole("textbox", { name: "Source location", exact: true });
    const quote = reference.getByRole("textbox", {
      name: "Exact quotation (optional)",
      exact: true,
    });
    const rationale = reference.getByRole("textbox", {
      name: "Why this source matters",
      exact: true,
    });
    await locator.fill("Maturity schedule, note 7");
    await quote.fill("Synthetic quotation.");
    await rationale.fill("Explains the working assumption.");
    await expect(
      editor.getByRole("button", { name: "Save report revision", exact: true }),
    ).toBeDisabled();
    await historyHeader.click();
    const olderLink = editor.getByRole("link", {
      name: new RegExp(`^Revision ${pastVersion} · Human \\(new tab\\)`),
    });
    await expect(olderLink).toHaveAttribute("href", pastUrl);
    await expect(editor.getByRole("button", { name: /^Revision 24 · Human/ })).toBeDisabled();
    async function inspectHistoryWithoutLeaving() {
      const [inspection] = await Promise.all([
        page.waitForEvent("popup"),
        width === 390 ? olderLink.click() : olderLink.press("Enter"),
      ]);
      await expect(inspection).toHaveURL(pastUrl);
      const pastSection = inspection.getByRole("textbox", { name: "Section text", exact: true });
      await expect(pastSection).toHaveValue(pastText);
      await expect(pastSection).toBeDisabled();
      await inspection.close();
      await expect(page).toHaveURL(headUrl);
      await expect(filter).toHaveValue("Maturity");
      await expect(maturity).toHaveAttribute("aria-current", "true");
      await expect(locator).toHaveValue("Maturity schedule, note 7");
      await expect(quote).toHaveValue("Synthetic quotation.");
      await expect(rationale).toHaveValue("Explains the working assumption.");
    }
    await inspectHistoryWithoutLeaving();

    await sectionText.fill(draftText);
    await sectionText.evaluate((input: HTMLTextAreaElement) => {
      input.setSelectionRange(12, 32, "backward");
      input.scrollTop = 120;
    });
    await inspectHistoryWithoutLeaving();
    await expect(sectionText).toHaveValue(draftText);
    expect(
      await sectionText.evaluate((input: HTMLTextAreaElement) => [
        input.selectionStart,
        input.selectionEnd,
        input.selectionDirection,
        input.scrollTop,
      ]),
    ).toEqual([12, 32, "backward", 120]);
    expect(writes).toEqual([]);
  });
}
