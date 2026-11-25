import { expect, test } from "./fixtures";
import { seed } from "./report-fixture";
import { contentUrl, type EvidenceRecord } from "../src/lib/evidence";
import type { ReportSave, ReportView } from "../src/lib/reports";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQiVkIAAHJASIPpoZkAAAAAElFTkSuQmCC",
  "base64",
);
const quote = "The newly captured note describes the synthetic method.";

for (const width of [390, 1440]) {
  test(`use recovered new sources in one explicit report revision at ${width}px`, async ({
    page,
    request,
  }) => {
    test.setTimeout(90000);
    const { record } = await seed(request, `draft sources ${width}`);
    const tag = `New material ${crypto.randomUUID().slice(0, 8)}`;
    const upload = await request.post("/api/artifacts?name=editor-draft-chart.png&rights=owned", {
      data: png,
      headers: { "Content-Type": "application/octet-stream" },
    });
    expect(upload.status(), await upload.text()).toBe(201);
    const image = await upload.json();
    expect(record.sources.some((source) => source.artifact?.id === image.id)).toBe(false);
    const chartResponse = await request.post("/api/evidence", {
      data: {
        id: crypto.randomUUID(),
        title: `${tag} chart`,
        kind: "image",
        representation: "chart_screenshot",
        rights: "owned",
        artifact_id: image.id,
      },
    });
    expect(chartResponse.status(), await chartResponse.text()).toBe(201);
    const chart: EvidenceRecord = await chartResponse.json();
    const noteResponse = await request.post("/api/evidence", {
      data: {
        id: crypto.randomUUID(),
        title: `${tag} note`,
        kind: "text",
        rights: "owned",
        parent_id: chart.id,
        text: quote,
      },
    });
    expect(noteResponse.status(), await noteResponse.text()).toBe(201);
    const note: EvidenceRecord = await noteResponse.json();
    const transientResponse = await request.post("/api/evidence", {
      data: {
        id: crypto.randomUUID(),
        title: `${tag} set aside`,
        kind: "text",
        rights: "owned",
        text: "Synthetic source removed while details were loading.",
      },
    });
    expect(transientResponse.status()).toBe(201);
    const transient: EvidenceRecord = await transientResponse.json();

    const held = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const isTransientRead = (url: URL) =>
      url.pathname === "/api/reports/draft-sources" &&
      url.searchParams.getAll("evidence_id").includes(transient.id);
    await page.route(isTransientRead, async (route) => {
      const response = await route.fetch();
      held.resolve();
      await release.promise;
      await route.fulfill({ response });
    });
    const saves: ReportSave[] = [];
    page.on("request", (entry) => {
      const path = new URL(entry.url()).pathname;
      if (entry.method() === "POST" && path === "/api/reports/revisions")
        saves.push(entry.postDataJSON());
    });

    await page.setViewportSize({ width, height: width === 390 ? 740 : 960 });
    const reportPath = (id: string) => `/?view=reports&report=${id}`;
    await page.goto(reportPath(record.id));
    const picker = page.getByRole("group", { name: /^Report source snapshots/ });
    const search = picker.getByRole("searchbox", { name: "Search evidence library" });
    const libraryNote = picker.getByRole("checkbox", { name: new RegExp(note.title) });
    const libraryChart = picker.getByRole("checkbox", { name: new RegExp(chart.title) });
    const discarded = picker.getByRole("checkbox", { name: new RegExp(transient.title) });
    const sectionSources = page.locator(".report-section-sources");
    const add = sectionSources.getByRole("button", { name: "Add source reference", exact: true });
    const source = sectionSources.getByRole("combobox", { name: "Reference source", exact: true });
    const chartToggle = sectionSources.getByRole("checkbox", { name: chart.title, exact: true });
    try {
      await search.fill(tag);
      await discarded.check();
      await held.promise;
      await discarded.uncheck();
      await libraryNote.check();
      await libraryChart.check();
      await add.click();
      await expect(source.getByRole("option", { name: note.title, exact: true })).toHaveCount(1);
      await expect(chartToggle).toBeEnabled();
      const late = page.waitForResponse((response) => isTransientRead(new URL(response.url())));
      release.resolve();
      await (await late).finished();
      await expect(source.getByRole("option", { name: transient.title, exact: true })).toHaveCount(
        0,
      );
      await expect(source.getByRole("option", { name: note.title, exact: true })).toHaveCount(1);
    } finally {
      release.resolve();
    }

    await source.selectOption(note.id);
    await expect(sectionSources.getByText("Basis: estimate", { exact: true })).toBeVisible();
    const inspect = sectionSources.getByRole("link", { name: "Inspect selected source (new tab)" });
    await expect(inspect).toHaveAttribute("href", `/?view=evidence&evidence=${note.id}`);
    await sectionSources
      .getByRole("textbox", { name: "Source location", exact: true })
      .fill("Opening sentence");
    await sectionSources
      .getByRole("textbox", { name: "Exact quotation (optional)", exact: true })
      .fill(quote);
    await sectionSources
      .getByRole("textbox", { name: "Why this source matters", exact: true })
      .fill("This is the stated method.");
    await sectionSources
      .getByRole("button", { name: "Apply reference to draft", exact: true })
      .click();
    await chartToggle.check();
    await expect(
      sectionSources.getByRole("img", { name: chart.title, exact: true }),
    ).toHaveAttribute("src", contentUrl(image.id) + "?preview=true");
    expect(saves).toEqual([]);

    await page.reload();
    await expect(
      page.getByText("Unsaved edits · Recovered from this browser", { exact: true }),
    ).toBeVisible();
    await expect(sectionSources.getByText(note.title, { exact: true })).toBeVisible();
    await expect(sectionSources.getByText(quote, { exact: true })).toBeVisible();
    await expect(chartToggle).toBeChecked();
    await search.fill(tag);
    await libraryNote.click();
    const removalNotice = page.getByRole("alert").filter({
      hasText: "Remove references or chart placements using this source",
    });
    await expect(removalNotice).toBeVisible();
    await expect(libraryNote).toBeChecked();
    await picker.getByText("Selected sources (4)", { exact: true }).click();
    await picker.getByRole("button", { name: `Remove ${chart.title}`, exact: true }).click();
    await expect(removalNotice).toBeVisible();
    await expect(libraryChart).toBeChecked();
    expect(saves).toEqual([]);

    const section = record.sections[0]!;
    const forged: ReportSave = {
      id: crypto.randomUUID(),
      base_revision_id: record.id,
      title: record.title,
      style_guide_id: record.style_guide_id,
      evidence_ids: [...record.sources, note, chart].map(({ id }) => id),
      sections: [
        {
          ...section,
          chart_ids: [chart.id],
          citations: [
            {
              evidence_id: note.id,
              relation: "supports",
              basis: "estimate",
              locator: "Opening sentence",
              quote: "This fabricated quote is absent from the selected note.",
              rationale: "Synthetic test.",
            },
          ],
        },
        ...record.sections.slice(1),
      ],
      change_note: "Exercise exact quote validation.",
    };
    const rejected = await request.post("/api/reports/revisions", { data: forged });
    expect(rejected.status()).toBe(422);
    expect((await rejected.json()).detail).toContain("must occur exactly");

    await page
      .getByRole("textbox", { name: "Revision change note", exact: true })
      .fill("Attach the exact note and chart together.");
    await page.getByRole("button", { name: "Save report revision", exact: true }).click();
    await expect(page.getByText("Saved revision 2", { exact: true })).toBeVisible();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.base_revision_id).toBe(record.id);
    expect(saves[0]!.evidence_ids).not.toContain(transient.id);
    const savedId = new URL(page.url()).searchParams.get("report")!;
    const saved: ReportView = await (await request.get(`/api/reports/${savedId}`)).json();
    expect(saved.current_revision_id).toBe(savedId);
    expect(saved.revision.provenance).toEqual(record.provenance);
    expect(saved.revision.sources).toEqual(expect.arrayContaining([note, chart]));
    expect(saved.revision.sections[0]!.citations).toContainEqual(
      expect.objectContaining({ evidence_id: note.id, basis: "estimate", quote }),
    );
    expect(saved.revision.sections[0]!.chart_ids).toContain(chart.id);
    expect(saved.review_status).toBe("unreviewed");
  });
}
