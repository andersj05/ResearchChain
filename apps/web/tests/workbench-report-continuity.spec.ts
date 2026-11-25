import type { ReportRevision, ReportSection } from "../src/lib/reports";
import { expect, test, type APIRequestContext, type Page } from "./fixtures";
import { seed } from "./report-fixture";

async function saveComparedRevision(
  request: APIRequestContext,
  base: ReportRevision,
  sections: ReportSection[],
  changeNote: string,
): Promise<ReportRevision> {
  const response = await request.post("/api/reports/revisions", {
    data: {
      id: crypto.randomUUID(),
      base_revision_id: base.id,
      title: base.title,
      style_guide_id: base.style_guide_id,
      evidence_ids: base.sources.map((source) => source.id),
      sections,
      change_note: changeNote,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

function editorFields(page: Page) {
  const editor = page.getByRole("region", { name: "Report editor", exact: true });
  return {
    editor,
    heading: editor.getByRole("textbox", { name: "Section heading", exact: true }),
    text: editor.getByRole("textbox", { name: "Section text", exact: true }),
    filter: editor.getByRole("searchbox", { name: "Find a section", exact: true }),
    last: editor.getByRole("button", { name: "12. Liquidity by maturity", exact: true }),
    save: editor.getByRole("button", { name: "Save report revision", exact: true }),
  };
}

function reportRequests(page: Page) {
  const reads: string[] = [];
  let writes = 0;
  page.on("request", (item) => {
    const path = new URL(item.url()).pathname;
    if (item.method() === "GET" && /^\/api\/(reports(?:\/|$)|style-guides$)/.test(path))
      reads.push(path);
    if (item.method() === "POST" && path === "/api/reports/revisions") writes++;
  });
  return { reads, writes: () => writes };
}

for (const width of [390, 1440]) {
  test(`return to the same unsaved report context at ${width}px`, async ({ page, request }) => {
    const { record } = await seed(request, `report continuity ${width}`);
    const originalBody = Array.from(
      { length: 45 },
      (_, index) => `Synthetic observation ${index + 1} compares two release dates.`,
    ).join("\n");
    const sections: ReportSection[] = Array.from({ length: 12 }, (_, index) => ({
      id: crypto.randomUUID(),
      heading:
        index === 0
          ? "Market context"
          : index === 11
            ? "Liquidity by maturity"
            : `Scenario ${index}`,
      body: index === 11 ? originalBody : `Synthetic saved discussion for section ${index + 1}.`,
      kind: "interpretation",
      citations: [],
      chart_ids: [],
    }));
    const previous = await saveComparedRevision(request, record, sections, "Create a long report.");
    const revisedSections = sections.map((section, index) =>
      index === 0 ? { ...section, body: "Synthetic revised market context." } : section,
    );
    const head = await saveComparedRevision(
      request,
      previous,
      revisedSections,
      "Update the market context.",
    );
    const { reads, writes } = reportRequests(page);
    page.on("dialog", (dialog) => dialog.accept());
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/?view=workflow&report=${head.id}`);
    await expect(page.getByRole("button", { name: "Run workflow", exact: true })).toBeEnabled();
    expect(reads).toEqual([]);

    const reportsTab = page.getByRole("tab", { name: "Reports", exact: true });
    const sourcesTab = page.getByRole("tab", { name: "Sources", exact: true });
    const { editor, heading, text, filter, last, save } = editorFields(page);
    await reportsTab.click();
    await expect(heading).toHaveValue("Market context");
    await filter.fill("Liquidity");
    await last.press("Enter");
    const unsaved = `Carry this synthetic edit across the Sources visit.\n${originalBody}`;
    await text.fill(unsaved);
    const range = await text.evaluate((input: HTMLTextAreaElement) => {
      input.setSelectionRange(410, 421, "forward");
      input.scrollTop = 402;
      return [input.selectionStart, input.selectionEnd, input.selectionDirection, input.scrollTop];
    });
    expect(range).toEqual([410, 421, "forward", 402]);
    await expect(last).toHaveAttribute("aria-current", "true");
    await sourcesTab.click();
    await expect(page.getByRole("heading", { name: /^Sources/ })).toBeVisible();
    await expect(editor).toBeHidden();
    const resumeRead = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/api/reports/${head.id}`,
    );
    await reportsTab.click();
    await resumeRead;
    await expect(save).toBeEnabled();
    await expect(reportsTab).toBeFocused();
    await expect(heading).toHaveValue("Liquidity by maturity");
    await expect(filter).toHaveValue("Liquidity");
    await expect(last).toHaveAttribute("aria-current", "true");
    await expect(text).toHaveValue(unsaved);
    expect(
      await text.evaluate((input: HTMLTextAreaElement) => [
        input.selectionStart,
        input.selectionEnd,
        input.selectionDirection,
        input.scrollTop,
      ]),
    ).toEqual(range);
    expect(writes()).toBe(0);

    await page.reload();
    await expect(heading).toHaveValue("Market context");
    await expect(filter).toBeEmpty();
    await last.press("Enter");
    await expect(text).toHaveValue(unsaved);
    await editor.getByText("Revision history", { exact: true }).click();
    const [inspection] = await Promise.all([
      page.waitForEvent("popup"),
      editor.getByRole("link", { name: /^Revision 2 · Human \(new tab\)/ }).click(),
    ]);
    const opened = editorFields(inspection);
    await expect(inspection).toHaveURL(`/?view=reports&report=${previous.id}`);
    await expect(opened.heading).toHaveValue("Market context");
    await expect(opened.text).toHaveValue(sections[0]!.body);
    await expect(opened.text).toBeDisabled();
    await inspection.close();
    await expect(page).toHaveURL(`/?view=reports&report=${head.id}`);
    await expect(last).toHaveAttribute("aria-current", "true");
    await expect(heading).toHaveValue("Liquidity by maturity");
    await expect(text).toHaveValue(unsaved);
    expect(writes()).toBe(0);
  });
}

test("returning to Reports checks the saved head before accepting another save", async ({
  page,
  request,
}) => {
  const { record } = await seed(request, "report return after external save");
  const { writes } = reportRequests(page);
  const url = `/?view=reports&report=${record.id}`;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  const { editor, text, save } = editorFields(page);
  const localText = "Keep this synthetic local edit after the external save.";
  await text.fill(localText);
  await editor
    .getByRole("textbox", { name: "Revision change note", exact: true })
    .fill("Local edit.");
  await expect(save).toBeEnabled();
  await page.getByRole("tab", { name: "Sources", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Sources/ })).toBeVisible();
  const latestText = "A second synthetic editor saved this revision.";
  const latest = await saveComparedRevision(
    request,
    record,
    record.sections.map((section, index) =>
      index === 0 ? { ...section, body: latestText } : section,
    ),
    "External update.",
  );

  const readStarted = Promise.withResolvers<void>();
  const releaseRead = Promise.withResolvers<void>();
  await page.route(
    `**/api/reports/${record.id}`,
    async (route) => {
      readStarted.resolve();
      await releaseRead.promise;
      await route.continue();
    },
    { times: 1 },
  );
  try {
    const reportsTab = page.getByRole("tab", { name: "Reports", exact: true });
    await reportsTab.click();
    await readStarted.promise;
    await expect(text).toHaveValue(localText);
    await expect(save).toBeDisabled();
    await expect(reportsTab).toBeFocused();
    releaseRead.resolve();
    await expect(editor.getByText(/A newer revision exists/)).toBeVisible();
    await expect(text).toHaveValue(localText);
    await expect(text).toBeDisabled();
    await expect(save).toBeDisabled();
    await editor.getByRole("button", { name: "Open latest revision", exact: true }).click();
    await expect(page).toHaveURL(`/?view=reports&report=${latest.id}`);
    await expect(text).toHaveValue(latestText);
    expect(writes()).toBe(0);
  } finally {
    releaseRead.resolve();
  }
});

test("a late report save receipt keeps Sources active and restores the saved section", async ({
  page,
  request,
  ownerSession,
}) => {
  const { record, source } = await seed(request, "late report receipt");
  const { writes } = reportRequests(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?view=reports&report=${record.id}`);
  const { editor, heading, text, save } = editorFields(page);
  const sectionName = "Synthetic late receipt section";
  const savedText = "Save this editorial context during a visit to Sources.";
  await editor.getByRole("button", { name: "Add section", exact: true }).click();
  await heading.fill(sectionName);
  await text.fill(savedText);
  await editor
    .getByRole("textbox", { name: "Revision change note", exact: true })
    .fill("Preserve the synthetic continuation.");

  const committed = Promise.withResolvers<ReportRevision>();
  const release = Promise.withResolvers<void>();
  await page.route(
    "**/api/reports/revisions",
    async (route) => {
      const receipt = await route.fetch();
      expect(receipt.status()).toBe(201);
      committed.resolve(await receipt.json());
      await release.promise;
      await route.fulfill({ response: receipt });
    },
    { times: 1 },
  );
  try {
    await save.click();
    const successor = await committed.promise;
    const sourcesTab = page.getByRole("tab", { name: "Sources", exact: true });
    await sourcesTab.click();
    const list = page.getByRole("complementary", { name: "Sources", exact: true });
    await list.getByText(source.title, { exact: true }).click();
    const inspection = page
      .getByRole("article", { name: "Source inspection", exact: true })
      .getByRole("heading", { name: source.title, exact: true });
    await expect(inspection).toBeFocused();
    await expect(page).toHaveURL(`/?view=evidence&report=${record.id}&evidence=${source.id}`);

    const successorRead = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/api/reports/${successor.id}`,
    );
    release.resolve();
    await successorRead;
    await expect.poll(() => new URL(page.url()).searchParams.get("report")).toBe(successor.id);
    await expect(sourcesTab).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(`/?view=evidence&report=${successor.id}&evidence=${source.id}`);
    await expect(inspection).toBeFocused();
    const oldDraft = `${ownerSession.prefix}.report.draft.${record.id}`;
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), oldDraft)).toBeNull();

    await page.getByRole("tab", { name: "Reports", exact: true }).click();
    const savedSection = editor.getByRole("button", {
      name: `${successor.sections.length}. ${sectionName}`,
      exact: true,
    });
    await expect(page).toHaveURL(`/?view=reports&report=${successor.id}&evidence=${source.id}`);
    await expect(editor.getByText("Saved revision 2", { exact: true })).toBeVisible();
    await expect(savedSection).toHaveAttribute("aria-current", "true");
    await expect(text).toHaveValue(savedText);
    expect(writes()).toBe(1);
    const history = await request.get(`/api/reports/${record.id}/history`);
    expect((await history.json()).map((entry: { id: string }) => entry.id)).toEqual([
      successor.id,
      record.id,
    ]);

    await page.reload();
    await expect(heading).toHaveValue(record.sections[0]!.heading);
    await expect(editor.getByText("Saved revision 2", { exact: true })).toBeVisible();
    await savedSection.press("Enter");
    await expect(text).toHaveValue(savedText);
    expect(writes()).toBe(1);
  } finally {
    release.resolve();
  }
});
