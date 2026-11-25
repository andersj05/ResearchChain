import { expect, test, type Page } from "./fixtures";
import type { ReportRevision, ReportView, StyleGuide } from "../src/lib/reports";

import { prepare, seed } from "./report-fixture";

function saveBody(record: ReportRevision, body: string) {
  return {
    id: crypto.randomUUID(),
    base_revision_id: record.id,
    title: record.title,
    style_guide_id: record.style_guide_id,
    evidence_ids: record.sources.map((s) => s.id),
    sections: record.sections.map((s, i) => (i === 0 ? { ...s, body } : s)),
    change_note: "Synthetic concurrent edit.",
  };
}
async function edit(page: Page, body: string) {
  await page.getByRole("textbox", { name: "Section text", exact: true }).fill(body);
  await page
    .getByRole("textbox", { name: "Revision change note", exact: true })
    .fill("Clarify the conditional argument.");
}

test("find a section in a long report and keep unsaved edits on a phone", async ({
  page,
  request,
}) => {
  const { record } = await seed(request, "section finder");
  const sections = Array.from({ length: 12 }, (_, index) => ({
    id: crypto.randomUUID(),
    heading:
      index === 0 ? "Market context" : index === 11 ? "Liquidity by maturity" : `Scenario ${index}`,
    body:
      index === 11
        ? "The terminal mismatch period was December."
        : `Synthetic discussion for section ${index + 1}.`,
    kind: "interpretation" as const,
    citations: [],
    chart_ids: [],
  }));
  const response = await request.post("/api/reports/revisions", {
    data: { ...saveBody(record, "Seed a longer synthetic draft"), sections },
  });
  expect(response.status()).toBe(201);
  const longReport: ReportRevision = await response.json();
  let revisionWrites = 0;
  page.on("request", (item) => {
    if (item.method() === "POST" && new URL(item.url()).pathname === "/api/reports/revisions")
      revisionWrites += 1;
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(`/?view=reports&report=${longReport.id}`);
  const outline = page.getByRole("navigation", { name: "Report sections", exact: true });
  const filter = page.getByRole("searchbox", { name: "Find a section", exact: true });
  const text = page.getByRole("textbox", { name: "Section text", exact: true });
  await expect(outline.getByRole("button")).toHaveCount(12);
  const unsaved = "A revised operator note for the market context.";
  await text.fill(unsaved);
  await filter.fill(" MISMATCH PERIOD ");
  await expect(outline.getByRole("button")).toHaveCount(1);
  await expect(text).toHaveValue(unsaved);
  const liquidity = outline.getByRole("button", { name: "12. Liquidity by maturity", exact: true });
  await liquidity.press("Enter");
  await expect(liquidity).toHaveAttribute("aria-current", "true");
  await expect(text).toHaveValue(sections[11]!.body);
  await filter.fill("operator NOTE");
  const market = outline.getByRole("button", { name: "1. Market context", exact: true });
  await expect(outline.getByRole("button")).toHaveCount(1);
  await market.press("Enter");
  await expect(text).toHaveValue(unsaved);
  await filter.fill("unmatched transcript");
  await expect(outline.getByRole("status")).toHaveText("No sections match your search.");
  await expect(text).toHaveValue(unsaved);
  await page.getByRole("button", { name: "Clear search", exact: true }).press("Enter");
  await expect(filter).toBeFocused();
  await expect(filter).toBeEmpty();
  await expect(outline.getByRole("button")).toHaveCount(12);
  await expect(market).toHaveAttribute("aria-current", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(revisionWrites).toBe(0);
  const savedView: ReportView = await (await request.get(`/api/reports/${longReport.id}`)).json();
  expect(savedView.revision.sections[0]!.body).toBe(sections[0]!.body);
});
for (const width of [1440, 390]) {
  test(`report authoring, review, style pinning and export on ${width}px`, async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(90000);
    page.on("dialog", (dialog) => dialog.accept());
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    const tag = crypto.randomUUID().slice(0, 8);
    const { source, chart, run } = await prepare(request, tag);
    await page.goto("/?view=reports");
    await page.getByRole("button", { name: "Style guides", exact: true }).click();
    await page.getByRole("button", { name: "New style guide", exact: true }).click();
    await page.getByRole("textbox", { name: "Guide title", exact: true }).fill(`Guide ${tag}`);
    await page.getByRole("button", { name: "Save style revision", exact: true }).click();
    await expect(
      page.getByRole("button", { name: `Revise Guide ${tag} v1`, exact: true }),
    ).toBeVisible();
    const guides: StyleGuide[] = await (await request.get("/api/style-guides")).json();
    const guide = guides.find((s) => s.title === `Guide ${tag}`)!;
    await page.getByRole("button", { name: "New report", exact: true }).click();
    await page.getByRole("textbox", { name: "Report title", exact: true }).fill(`Report ${tag}`);
    await page
      .getByRole("combobox", { name: "Recorded research run", exact: true })
      .selectOption(run.id);
    await expect(
      page.getByRole("combobox", { name: "Completed research result", exact: true }),
    ).toHaveValue(run.model_attempts[0].id);
    await page
      .getByRole("combobox", { name: "Pinned style guide", exact: true })
      .selectOption(guide.id);
    await page.getByRole("button", { name: "Create report draft", exact: true }).click();
    await expect(page.getByRole("heading", { name: `Report ${tag}`, exact: true })).toBeVisible();
    const firstId = new URL(page.url()).searchParams.get("report")!;
    const first: ReportView = await (await request.get(`/api/reports/${firstId}`)).json();
    await edit(page, "A 😀 carefully supported observation. Its interpretation remains uncertain.");
    await page.getByRole("button", { name: "Add source reference", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Reference source", exact: true })
      .selectOption(source.id);
    await page.getByRole("textbox", { name: "Source location", exact: true }).fill("Sentence 1");
    await page
      .getByRole("textbox", { name: "Exact quotation (optional)", exact: true })
      .fill("An exact synthetic quotation.");
    await page
      .getByRole("textbox", { name: "Why this source matters", exact: true })
      .fill("Supports the synthetic observation only.");
    await page.getByRole("button", { name: "Apply reference to draft", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Section classification", exact: true })
      .selectOption("fact");
    await page.getByRole("checkbox", { name: chart.title, exact: true }).check();
    await page.getByRole("button", { name: "Add section", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Section heading", exact: true })
      .fill("Conditional scenario");
    await page
      .getByRole("textbox", { name: "Section text", exact: true })
      .fill("If the mechanism holds, the next observation could differ.");
    await page
      .getByRole("combobox", { name: "Section classification", exact: true })
      .selectOption("scenario");
    await page.getByRole("button", { name: "Move earlier", exact: true }).click();
    await page.getByRole("button", { name: "Move later", exact: true }).click();
    await page.getByRole("button", { name: "1. Research conclusion", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Export review bundle", exact: true }),
    ).toBeDisabled();
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Section text", exact: true })).toHaveValue(
      "A 😀 carefully supported observation. Its interpretation remains uncertain.",
    );
    await expect(
      page.getByText("Unsaved edits · Recovered from this browser", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Save report revision", exact: true }).click();
    await expect(page.getByText("Saved revision 2", { exact: true })).toBeVisible();
    const secondId = new URL(page.url()).searchParams.get("report")!;
    expect(secondId).not.toBe(firstId);
    const chartImage = page.getByRole("img", { name: chart.title, exact: true });
    await expect(chartImage).toBeVisible();
    expect(await chartImage.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(1);
    await page.locator(".reports-view").evaluate((el) => (el.scrollTop = 0));
    await page.screenshot({ path: testInfo.outputPath("report-editor.png"), fullPage: true });
    const review = page.getByRole("region", { name: "Editorial feedback", exact: true });
    await review
      .getByRole("combobox", { name: "Feedback scope", exact: true })
      .selectOption(first.revision.sections[0]!.id);
    const anchor = review.getByRole("textbox", {
      name: "Select text to anchor this comment",
      exact: true,
    });
    await anchor.evaluate((element) => {
      const input = element as HTMLTextAreaElement;
      input.focus();
      input.setSelectionRange(2, 4);
    });
    await review.getByRole("button", { name: "Use selected text", exact: true }).click();
    await expect(
      review.getByText("Characters 2–3 (Unicode code points)", { exact: true }),
    ).toBeVisible();
    await review
      .getByRole("textbox", { name: "Feedback reason", exact: true })
      .fill("Synthetic comment on the exact character.");
    await review.getByRole("button", { name: "Save editorial feedback", exact: true }).click();
    await expect(
      review.getByText("Synthetic comment on the exact character.", { exact: true }),
    ).toBeVisible();
    await review.getByRole("combobox", { name: "Feedback scope", exact: true }).selectOption("");
    await review
      .getByRole("combobox", { name: "Feedback type", exact: true })
      .selectOption("decision");
    await review
      .getByRole("textbox", { name: "Feedback reason", exact: true })
      .fill("Accept this synthetic revision only.");
    await review.getByRole("button", { name: "Save editorial feedback", exact: true }).click();
    await expect(review.getByText("Whole-report review: accepted", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "All reports", exact: true }).click();
    await page.getByRole("button", { name: "Style guides", exact: true }).click();
    await page.getByRole("button", { name: `Revise Guide ${tag} v1`, exact: true }).click();
    await page
      .getByRole("textbox", { name: "Prose voice", exact: true })
      .fill("State the conditional conclusion first, then its limitation.");
    await page
      .getByRole("textbox", { name: "Guide change note", exact: true })
      .fill("Synthetic voice revision.");
    await page.getByRole("button", { name: "Save style revision", exact: true }).click();
    await expect(
      page.getByRole("button", { name: `Revise Guide ${tag} v2`, exact: true }),
    ).toBeVisible();
    await page.goto(`/?view=reports&report=${secondId}`);
    await expect(
      page.getByRole("combobox", { name: "Pinned style guide", exact: true }),
    ).toHaveValue(guide.id);
    const updatedGuides: StyleGuide[] = await (await request.get("/api/style-guides")).json();
    const updated = updatedGuides.find((s) => s.series_id === guide.id && s.version === 2)!;
    await page
      .getByRole("combobox", { name: "Pinned style guide", exact: true })
      .selectOption(updated.id);
    await page
      .getByRole("textbox", { name: "Revision change note", exact: true })
      .fill("Adopt the revised guide explicitly.");
    await page.getByRole("button", { name: "Save report revision", exact: true }).click();
    await expect(page.getByText("Saved revision 3", { exact: true })).toBeVisible();
    await expect(
      review.getByText("Whole-report review: unreviewed", { exact: true }),
    ).toBeVisible();
    expect((await (await request.get(`/api/reports/${secondId}`)).json()).review_status).toBe(
      "accepted",
    );
    await review
      .getByRole("combobox", { name: "Feedback type", exact: true })
      .selectOption("preference");
    await expect(
      review.getByRole("textbox", { name: "Previous revision text", exact: true }),
    ).toBeVisible();
    await review
      .getByRole("textbox", { name: "Feedback reason", exact: true })
      .fill("Synthetic preference for the revised guide.");
    await review.getByRole("button", { name: "Save editorial feedback", exact: true }).click();
    await expect(
      review.getByText("Synthetic preference for the revised guide.", { exact: true }),
    ).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export review bundle", exact: true }).click();
    const bundle = await download;
    expect(bundle.suggestedFilename()).toMatch(/^report-.*\.zip$/);
    expect(await bundle.failure()).toBeNull();
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("preview only the selected unsaved report section and retain the draft on a phone", async ({
  page,
  request,
}) => {
  const { record } = await seed(request, crypto.randomUUID().slice(0, 8));
  let saves = 0;
  await page.route("**/api/reports/revisions", (route) => {
    if (route.request().method() === "POST") saves++;
    return route.continue();
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?view=reports&report=${record.id}`);
  const editor = page.getByRole("region", { name: "Report editor", exact: true });
  const text = editor.getByRole("textbox", { name: "Section text", exact: true });
  const heading = editor.getByRole("textbox", { name: "Section heading", exact: true });
  const outline = editor.getByRole("navigation", { name: "Report sections" });
  const open = editor.getByRole("button", { name: "Preview draft section", exact: true });
  const close = editor.getByRole("button", { name: "Return to section text", exact: true });
  const preview = editor.getByRole("region", { name: "Unsaved section preview", exact: true });
  const firstHeading = "Edited release summary";
  const secondHeading = "Independent comparison";
  const firstText = "**Ordinary report text stays plain.**\n<img src='https://preview.test/a.png'>";
  const secondText = "An unsaved comparison belongs only to this section.";

  await heading.fill(firstHeading);
  await text.fill(firstText);
  await text.evaluate((input: HTMLTextAreaElement) => input.setSelectionRange(2, 16));
  await expect(preview).toHaveCount(0);
  await open.press("Enter");
  await expect(preview.getByRole("heading", { name: firstHeading })).toBeVisible();
  await expect(preview).toContainText("**Ordinary report text stays plain.**");
  await expect(preview).toContainText("<img src='https://preview.test/a.png'>");
  await expect(preview.locator("img")).toHaveCount(0);
  await close.press("Enter");
  await expect(text).toBeFocused();
  expect(
    await text.evaluate((input: HTMLTextAreaElement) => [input.selectionStart, input.selectionEnd]),
  ).toEqual([2, 16]);

  await editor.getByRole("button", { name: "Add section", exact: true }).click();
  await heading.fill(secondHeading);
  await text.fill(secondText);
  await open.press("Enter");
  await expect(preview.getByRole("heading", { name: secondHeading })).toBeVisible();
  await expect(preview).toContainText(secondText);
  await expect(preview).not.toContainText(firstText);
  await outline.getByRole("button", { name: new RegExp(firstHeading) }).press("Enter");
  await expect(preview.getByRole("heading", { name: firstHeading })).toBeVisible();
  await expect(preview).not.toContainText(secondText);
  await close.press("Enter");
  await expect(text).toHaveValue(firstText);

  await page.reload();
  await expect(editor.getByText("Unsaved edits · Recovered from this browser")).toBeVisible();
  await expect(text).toHaveValue(firstText);
  await outline.getByRole("button", { name: new RegExp(secondHeading) }).press("Enter");
  await expect(text).toHaveValue(secondText);
  const saved = editor.locator("details.report-preview");
  await saved.locator("summary").press("Enter");
  await expect(saved).toContainText(record.sections[0]!.body);
  await expect(saved).not.toContainText(firstHeading);
  await expect(saved).not.toContainText(secondHeading);
  expect(saves).toBe(0);
  const unchanged: ReportView = await (await request.get(`/api/reports/${record.id}`)).json();
  expect(unchanged.current_revision_id).toBe(record.id);
  expect(unchanged.revision).toEqual(record);
});

test("preview study draft links and figures from the saved editor inventory only", async ({
  page,
  request,
}) => {
  const { record, chart } = await seed(request, crypto.randomUUID().slice(0, 8));
  const view: ReportView = await (await request.get(`/api/reports/${record.id}`)).json();
  const artifact = chart.artifact!;
  const recorded = "https://preview.test/recorded";
  const unrecorded = "https://preview.test/unrecorded";
  const artifactPath = `/api/artifacts/${encodeURIComponent(artifact.id)}/content`;
  let figureReads = 0;
  let externalReads = 0;
  let saves = 0;
  await page.route("https://preview.test/**", (route) => {
    externalReads++;
    return route.abort();
  });
  await page.route(`**${artifactPath}?preview=true`, (route) => {
    figureReads++;
    return route.continue();
  });
  await page.route("**/api/reports/revisions", (route) => {
    if (route.request().method() === "POST") saves++;
    return route.continue();
  });
  await page.route(`**/api/reports/${record.id}`, (route) =>
    route.fulfill({
      json: {
        ...view,
        revision: {
          ...record,
          provenance: {
            ...record.provenance,
            renderer: "study-markdown-1",
            recorded_urls: [recorded],
            attempt: {
              ...record.provenance.attempt,
              result: {
                ...record.provenance.attempt.result,
                workspace_files: [
                  {
                    name: "pinned.png",
                    media_type: "image/png",
                    artifact_id: artifact.id,
                    byte_size: artifact.byte_size,
                  },
                ],
              },
            },
          },
        },
      },
    }),
  );
  await page.goto(`/?view=reports&report=${record.id}`);
  const text = page.getByRole("textbox", { name: "Section text", exact: true });
  await text.fill(
    [
      "**Unsaved study wording**",
      `[Recorded reference](${recorded})`,
      `[Unrecorded reference](${unrecorded})`,
      "![Pinned editor figure](pinned.png)",
      `![External figure](${unrecorded}/figure.png)`,
    ].join("\n\n"),
  );
  expect(figureReads).toBe(0);
  await page.getByRole("button", { name: "Preview draft section", exact: true }).press("Enter");
  const preview = page.getByRole("region", { name: "Unsaved section preview" });
  await expect(preview.locator("strong")).toHaveText("Unsaved study wording");
  await expect(
    preview.getByRole("link", { name: "Recorded reference", exact: true }),
  ).toHaveAttribute("href", recorded);
  await expect(preview.getByRole("link", { name: "Unrecorded reference" })).toHaveCount(0);
  await expect(preview).toContainText("Unrecorded reference");
  await expect(preview.getByRole("img")).toHaveCount(1);
  const figure = preview.getByRole("img", { name: "Pinned editor figure" });
  await expect(figure).toHaveAttribute("src", `${artifactPath}?preview=true`);
  await expect
    .poll(() =>
      figure.evaluate((image: HTMLImageElement) => {
        image.scrollIntoView({ block: "nearest" });
        return image.naturalWidth;
      }),
    )
    .toBe(1);
  const editedHeading = "Adjusted section heading";
  await page.getByRole("textbox", { name: "Section heading", exact: true }).fill(editedHeading);
  await expect(preview.getByRole("heading", { name: editedHeading, exact: true })).toBeVisible();
  await expect(figure).toHaveAttribute("src", `${artifactPath}?preview=true`);
  expect(figureReads).toBe(1);
  expect(externalReads).toBe(0);
  expect(saves).toBe(0);
});

test("complete an attempted report save from its missing change note on a phone", async ({
  page,
  request,
}) => {
  const { record } = await seed(request, crypto.randomUUID().slice(0, 8));
  const posted: { sections: { body: string }[]; change_note: string }[] = [];
  await page.route("**/api/reports/revisions", (route) => {
    if (route.request().method() === "POST") posted.push(route.request().postDataJSON());
    return route.continue();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?view=reports&report=${record.id}`);
  const editor = page.getByRole("region", { name: "Report editor", exact: true });
  const section = editor.getByRole("textbox", { name: "Section text", exact: true });
  const note = editor.getByRole("textbox", { name: "Revision change note", exact: true });
  const save = editor.getByRole("button", { name: "Save report revision", exact: true });
  const continueSave = editor.getByRole("button", {
    name: "Continue saving revision",
    exact: true,
  });
  const body = [
    "Revised synthetic interpretation of the release dates.",
    ...Array.from(
      { length: 120 },
      (_, index) => `Observation ${index + 1} compares a different period.`,
    ),
  ].join("\n\n");
  const changeNote = "Explain the date comparison and keep the observations separate.";
  await section.fill(body);
  await expect(note).toBeEmpty();
  await expect(continueSave).toHaveCount(0);
  await save.press("Enter");
  await expect(note).toBeFocused();
  await expect(note).toBeInViewport();
  await expect(note).toHaveAttribute("aria-invalid", "true");
  await expect(note).toHaveAccessibleDescription("Add a change note before saving this revision.");
  await expect(continueSave).toBeDisabled();
  expect(posted).toEqual([]);

  await note.fill("   ");
  await expect(continueSave).toBeDisabled();
  expect(posted).toEqual([]);
  await note.fill(changeNote);
  await expect(note).not.toHaveAttribute("aria-invalid", "true");
  await continueSave.press("Enter");

  await expect(editor.getByText("Saved revision 2", { exact: true })).toBeVisible();
  await expect(continueSave).toHaveCount(0);
  expect(posted).toHaveLength(1);
  expect(posted[0]?.change_note).toBe(changeNote);
  expect(posted[0]?.sections[0]?.body).toBe(body);
  const savedId = new URL(page.url()).searchParams.get("report");
  expect(savedId).not.toBe(record.id);
  const saved: ReportView = await (await request.get(`/api/reports/${savedId}`)).json();
  expect(saved.revision.change_note).toBe(changeNote);
  expect(saved.revision.sections[0]?.body).toBe(body);
  const original: ReportView = await (await request.get(`/api/reports/${record.id}`)).json();
  expect(original.revision.sections[0]?.body).toBe(record.sections[0]?.body);
});

test("report save receipt survives a lost response and refresh", async ({
  page,
  request,
  ownerSession,
}) => {
  page.on("dialog", (d) => d.accept());
  const { record } = await seed(request, crypto.randomUUID().slice(0, 8));
  await page.goto(`/?view=reports&report=${record.id}`);
  await edit(page, "Recovered after a response was lost.");
  let committed = false;
  await page.route("**/api/reports/revisions", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    committed = true;
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Save report revision", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Report editor", exact: true }).getByRole("alert"),
  ).toContainText(/fetch|network/i);
  expect(committed).toBe(true);
  await page.unroute("**/api/reports/revisions");
  await page.reload();
  await expect(page.getByRole("button", { name: "Retry pending save", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Retry pending save", exact: true }).click();
  await expect(page.getByText("Saved revision 2", { exact: true })).toBeVisible();
  expect((await (await request.get(`/api/reports/${record.id}/history`)).json()).length).toBe(2);
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      `${ownerSession.prefix}.report.draft.${record.id}`,
    ),
  ).toBeNull();
});

test("a stale report edit retains its local text and reveals the latest revision", async ({
  page,
  request,
}) => {
  page.on("dialog", (d) => d.accept());
  const { record } = await seed(request, crypto.randomUUID().slice(0, 8));
  await page.goto(`/?view=reports&report=${record.id}`);
  await edit(page, "My local draft must survive a conflict.");
  const response = await request.post("/api/reports/revisions", {
    data: saveBody(record, "Another editor saved this version."),
  });
  expect(response.status()).toBe(201);
  await page.getByRole("button", { name: "Save report revision", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Report editor", exact: true }).getByRole("alert"),
  ).toContainText("newer revision");
  await expect(page.getByRole("textbox", { name: "Section text", exact: true })).toHaveValue(
    "My local draft must survive a conflict.",
  );
  await page.getByRole("button", { name: "Open latest revision", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Section text", exact: true })).toHaveValue(
    "Another editor saved this version.",
  );
  await page.goto(`/?view=reports&report=${record.id}`);
  await expect(page.getByRole("textbox", { name: "Section text", exact: true })).toHaveValue(
    "My local draft must survive a conflict.",
  );
  expect((await (await request.get(`/api/reports/${record.id}/history`)).json()).length).toBe(2);
});

test("a delayed guide refresh cannot hide a newly saved style", async ({ page }) => {
  await page.goto("/?view=reports");
  await expect(page.getByRole("heading", { name: "Recent reports", exact: true })).toBeVisible();
  const captured = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let held = false;
  await page.route("**/api/style-guides", async (route) => {
    if (route.request().method() !== "GET" || held) return route.continue();
    held = true;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    captured.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  const title = `Delayed guide ${crypto.randomUUID()}`;
  try {
    await page.getByRole("button", { name: "Style guides", exact: true }).click();
    await captured.promise;
    await page.getByRole("button", { name: "New style guide", exact: true }).click();
    await page.getByRole("textbox", { name: "Guide title", exact: true }).fill(title);
    await page.getByRole("button", { name: "Save style revision", exact: true }).click();
    await expect(
      page.getByRole("button", { name: `Revise ${title} v1`, exact: true }),
    ).toBeVisible();
    const completed = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/style-guides") && response.request().method() === "GET",
    );
    release.resolve();
    await completed;
    await page.getByRole("button", { name: "New report", exact: true }).click();
    await expect(
      page
        .getByRole("combobox", { name: "Pinned style guide", exact: true })
        .locator("option")
        .filter({ hasText: title }),
    ).toHaveCount(1);
  } finally {
    release.resolve();
  }
});
