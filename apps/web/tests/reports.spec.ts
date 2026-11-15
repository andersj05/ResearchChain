import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import research from "../../../examples/hypothesis-research.json";
import type { ReportRevision, ReportView, StyleGuide } from "../src/lib/reports";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=",
  "base64",
);
async function prepare(request: APIRequestContext, tag: string) {
  const sourceResponse = await request.post("/api/evidence", {
    data: {
      id: crypto.randomUUID(),
      title: `Report source ${tag}`,
      kind: "text",
      rights: "owned",
      text: "An exact synthetic quotation. This is not market evidence.",
    },
  });
  expect(sourceResponse.status()).toBe(201);
  const source = await sourceResponse.json();
  const uploaded = await request.post("/api/artifacts?name=chart.png&rights=owned", {
    data: png,
    headers: { "Content-Type": "application/octet-stream" },
  });
  expect(uploaded.status()).toBe(201);
  const artifact = await uploaded.json();
  const chartResponse = await request.post("/api/evidence", {
    data: {
      id: crypto.randomUUID(),
      title: `Captured chart ${tag}`,
      kind: "image",
      representation: "chart_screenshot",
      rights: "owned",
      artifact_id: artifact.id,
      notes: "Synthetic image fixture; no market observations.",
    },
  });
  expect(chartResponse.status()).toBe(201);
  const chart = await chartResponse.json();
  const document = structuredClone(research);
  document.name = `Report research ${tag}`;
  document.research.model = "test-model";
  const workflowResponse = await request.post("/api/revisions", { data: document });
  expect(workflowResponse.status()).toBe(201);
  const revision = await workflowResponse.json();
  const runResponse = await request.post("/api/runs", {
    data: {
      id: crypto.randomUUID(),
      revision_id: revision.id,
      brief: "Synthetic report editing fixture.",
      evidence_ids: [source.id, chart.id],
      provider_account_id: "oaiapp_fixture",
    },
    timeout: 45000,
  });
  expect(runResponse.status()).toBe(201);
  return { source, chart, run: await runResponse.json() };
}
function styleBody(tag: string) {
  return {
    id: crypto.randomUUID(),
    title: `Guide ${tag}`,
    analytical_structure: "Mechanism, alternatives, falsifiers.",
    voice: "Direct and conditional.",
    source_discipline: "Cite original sources and dates.",
    scenarios: "Conditional, not forecasts.",
    examples: [
      {
        kind: "structure",
        principle: "Explain alternatives.",
        example: "A could explain X; B is not excluded.",
      },
      {
        kind: "voice",
        principle: "Name uncertainty.",
        example: "The source cannot establish causation.",
      },
    ],
    change_note: "Synthetic guide.",
  };
}
async function seed(request: APIRequestContext, tag: string) {
  const context = await prepare(request, tag);
  const style = await request.post("/api/style-guides", { data: styleBody(tag) });
  expect(style.status()).toBe(201);
  const guide: StyleGuide = await style.json();
  const response = await request.post("/api/reports", {
    data: {
      id: crypto.randomUUID(),
      title: `Report ${tag}`,
      run_id: context.run.id,
      attempt_id: context.run.model_attempts[0].id,
      style_guide_id: guide.id,
    },
  });
  expect(response.status()).toBe(201);
  return { ...context, guide, record: (await response.json()) as ReportRevision };
}
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

test("report save receipt survives a lost response and refresh", async ({ page, request }) => {
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
      (id) => localStorage.getItem(`researchchain.report.draft.${id}`),
      record.id,
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
