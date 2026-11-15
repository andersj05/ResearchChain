import { expect, test, type Page, type APIRequestContext } from "./fixtures";

async function source(request: APIRequestContext, tag: string) {
  const result = await request.post("/api/evidence", {
    data: {
      id: crypto.randomUUID(),
      title: `Evaluation source ${tag}`,
      kind: "text",
      rights: "owned",
      text: `Synthetic primary source ${tag}. These are test observations, not market data.`,
      published_date: new Date().toISOString().slice(0, 10),
    },
  });
  expect(result.status()).toBe(201);
  return result.json();
}

async function addCandidate(page: Page, tag: string, suffix: string) {
  await page.getByRole("button", { name: "Add candidate", exact: true }).click();
  await page.getByLabel("Candidate label", { exact: true }).fill(`Candidate ${suffix} ${tag}`);
  await page.getByRole("combobox", { name: "Output source", exact: true }).selectOption("imported");
  await page
    .getByLabel("Candidate text", { exact: true })
    .fill(`A ðŸ˜€ synthetic draft ${suffix} with a carefully stated limitation.`);
  await page
    .getByRole("combobox", { name: "Output origin", exact: true })
    .selectOption("synthetic");
  await page.getByLabel("Model or author", { exact: true }).fill(`hidden-model-${suffix}-${tag}`);
  await page.getByLabel("Workflow version", { exact: true }).fill("fixture-workflow-1");
  await page.getByLabel("Prompt version", { exact: true }).fill("fixture-prompt-1");
  await page.getByLabel("Tool / data process version", { exact: true }).fill("fixture-sources-1");
  await page
    .getByLabel("Complete generation input", { exact: true })
    .fill(`Assess the synthetic mechanism ${tag}.`);
  await page.getByRole("button", { name: "Save candidate", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: `Candidate ${suffix} ${tag}`, exact: true }),
  ).toBeVisible();
}

for (const width of [1440, 390]) {
  test(`dataset, blind review, Unicode edit and archive on ${width}px`, async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(60000);
    const tag = crypto.randomUUID().slice(0, 8);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    const savedSource = await source(request, tag);
    const baseline = await request.post("/api/evaluations/references", {
      data: {
        id: crypto.randomUUID(),
        title: `Hidden baseline ${tag}`,
        text: `Synthetic baseline reference ${tag}: a different conclusion reserved for judging after preference submission.`,
        author: "Fixture author",
        origin: "synthetic",
        development_only: true,
      },
    });
    expect(baseline.status()).toBe(201);
    await page.goto("/?view=evaluations");
    await page.getByRole("button", { name: "New dataset", exact: true }).click();
    await page.getByLabel("Dataset title", { exact: true }).fill(`Evaluation ${tag}`);
    await page.getByLabel("Case title", { exact: true }).fill(`Mechanism ${tag}`);
    await page.getByLabel("Case identifier", { exact: true }).fill(`case-${tag}`);
    await page.getByLabel("Topic identifier", { exact: true }).fill(`topic-${tag}`);
    await page
      .getByLabel("Research or writing brief", { exact: true })
      .fill(`Assess the synthetic mechanism ${tag}.`);
    await page
      .getByRole("group", { name: /Allowed evidence/ })
      .getByRole("checkbox", { name: new RegExp(`Evaluation source ${tag}`) })
      .check();
    await page
      .getByRole("checkbox", { name: `Hidden baseline ${tag} Â· development only`, exact: true })
      .check();
    await page
      .getByRole("checkbox", { name: "Synthetic fixture (excluded from calibration)", exact: true })
      .check();
    await page.getByRole("button", { name: "Save dataset revision", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: `Mechanism ${tag}`, exact: true }),
    ).toBeVisible();
    const datasetId = new URL(page.url()).searchParams.get("dataset")!;
    const packet = await request.get(
      `/api/evaluations/datasets/${datasetId}/cases/case-${tag}/inputs`,
    );
    expect(packet.status()).toBe(200);
    expect(await packet.text()).not.toContain("Hidden baseline");
    expect((await packet.json()).evidence[0].id).toBe(savedSource.id);
    await addCandidate(page, tag, "A");
    await addCandidate(page, tag, "B");
    await page.getByRole("checkbox", { name: `Candidate A ${tag}`, exact: true }).check();
    await page.getByRole("checkbox", { name: `Candidate B ${tag}`, exact: true }).check();
    await page.getByRole("button", { name: "Create blind comparison", exact: true }).click();
    const region = page.getByRole("region", { name: "Blind comparison", exact: true });
    await expect(region).toBeVisible();
    await expect(region).not.toContainText(`hidden-model-A-${tag}`);
    await expect(region).not.toContainText(`Hidden baseline ${tag}`);
    const comparisonId = new URL(page.url()).searchParams.get("comparison")!;
    const blind = await request.get(`/api/evaluations/comparisons/${comparisonId}`);
    expect(await blind.text()).not.toContain(`hidden-model-A-${tag}`);
    await page.locator(".evaluations-view").evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({ path: testInfo.outputPath("evaluation-blind.png"), fullPage: true });
    const original = await page
      .getByRole("textbox", { name: "Draft A text", exact: true })
      .inputValue();
    await page
      .getByRole("textbox", { name: "Draft A text", exact: true })
      .evaluate((element: HTMLTextAreaElement) => {
        const start = element.value.indexOf("synthetic");
        element.focus();
        element.setSelectionRange(start, start + 9);
      });
    await page.getByRole("button", { name: "Edit selected text in A", exact: true }).click();
    await page.getByRole("textbox", { name: "Replacement", exact: true }).fill("illustrative");
    await page.getByLabel("Edit reason", { exact: true }).fill("Make the fixture origin explicit.");
    await page.getByRole("button", { name: "Add edit", exact: true }).click();
    if (width === 1440) {
      await page.getByText("Register an existing judge prediction", { exact: true }).click();
      await page
        .getByRole("textbox", { name: "Judge model", exact: true })
        .fill(`fixture-judge-${tag}`);
      await page
        .getByRole("textbox", { name: "Judge prompt version", exact: true })
        .fill("fixture-judge-v1");
      await page
        .getByRole("textbox", { name: "Exact judge prompt", exact: true })
        .fill("Compare support and clarity. Synthetic test prediction.");
      await page.getByRole("spinbutton", { name: "Draft A probability", exact: true }).fill("0.2");
      await page.getByRole("spinbutton", { name: "Draft B probability", exact: true }).fill("0.2");
      await page.getByRole("spinbutton", { name: "Tie probability", exact: true }).fill("0.6");
      await page
        .getByRole("textbox", { name: "Judge reasoning", exact: true })
        .fill("Both synthetic drafts have similar limitations.");
      await page.getByRole("button", { name: "Register prediction", exact: true }).click();
      await expect(
        page.getByText("Prediction registered before human review. No model was called.", {
          exact: true,
        }),
      ).toBeVisible();
    }
    for (const side of ["A", "B"]) {
      const grade = page.getByRole("group", { name: `Draft ${side} assessment`, exact: true });
      await grade
        .getByLabel("Gate reasoning", { exact: true })
        .fill("Synthetic text requires an independent source check.");
      await grade
        .getByRole("combobox", { name: "Factual accuracy", exact: true })
        .selectOption("unassessed");
    }
    const leftGrade = page.getByRole("group", { name: "Draft A assessment", exact: true });
    await leftGrade.getByText("Writing ratings (optional)", { exact: true }).click();
    await leftGrade.getByRole("combobox", { name: "Clarity", exact: true }).selectOption("4");
    await leftGrade.getByRole("combobox", { name: "Edit burden", exact: true }).selectOption("2");
    await page
      .getByRole("combobox", { name: "Pairwise preference", exact: true })
      .selectOption("tie");
    await page
      .getByLabel("Preference reason", { exact: true })
      .fill("Both fixtures clearly describe their limits.");
    await page
      .getByRole("button", { name: "Save review and reveal provenance", exact: true })
      .click();
    const reveal = page.getByRole("region", { name: "Revealed provenance", exact: true });
    await expect(reveal).toBeVisible();
    await expect(reveal).toContainText(`hidden-model-A-${tag}`);
    await expect(reveal).toContainText("Draft A: not qualified");
    const reviewed = await (
      await request.get(`/api/evaluations/comparisons/${comparisonId}`)
    ).json();
    expect(reviewed.feedback.edits[0].original).toBe("synthetic");
    expect(reviewed.feedback.edits[0].start).toBe(
      Array.from(original.slice(0, original.indexOf("synthetic"))).length,
    );
    expect(reviewed.feedback.left_qualified).toBe(false);
    expect(reviewed.feedback.left_ratings.clarity).toBe(4);
    expect(reviewed.feedback.left_ratings.edit_burden).toBe(2);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download comparison", exact: true }).click();
    const download = await downloadPromise;
    const path = testInfo.outputPath("comparison.json");
    await download.saveAs(path);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Review saved", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to evaluations", exact: true }).click();
    await page.getByRole("button", { name: "Archives", exact: true }).click();
    await page.getByLabel("Import comparison JSON", { exact: true }).setInputFiles(path);
    await expect(
      page.getByRole("region", { name: "Archived comparison", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Imported archive Â· unverified provenance.", { exact: false }),
    ).toBeVisible();
    await page.locator(".evaluations-view").evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({ path: testInfo.outputPath("evaluation-reviewed.png"), fullPage: true });
    if (width === 1440) {
      await page.getByRole("button", { name: "Back to evaluations", exact: true }).click();
      await page.getByRole("button", { name: "Judge calibration", exact: true }).click();
      const score = page.locator(".eval-score").filter({ hasText: `fixture-judge-${tag}` });
      await expect(score).toContainText("Insufficient data for calibration");
      await expect(score).toContainText("0 / 0");
    }
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("historical unknowns block generation export and revisions preserve the old case", async ({
  page,
  request,
}) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const original = await source(request, tag);
  const dataset = await request.post("/api/evaluations/datasets", {
    data: {
      id: crypto.randomUUID(),
      title: `Historical ${tag}`,
      cases: [
        {
          id: "old",
          title: `Historical case ${tag}`,
          topic: `history-${tag}`,
          partition: "development",
          track: "full_research",
          brief: "Inspect historical uncertainty.",
          period_start: "2020-01-01",
          as_of_date: "2020-12-31",
          evidence_ids: [original.id],
          synthetic: true,
        },
      ],
    },
  });
  expect(dataset.status()).toBe(201);
  const saved = await dataset.json();
  await page.goto(`/?view=evaluations&dataset=${saved.id}`);
  await expect(page.getByText("Input checks need attention", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download generation inputs", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Revise dataset", exact: true }).click();
  await page.getByLabel("Period start (optional)", { exact: true }).fill("");
  await page.getByLabel("Historical cutoff (optional)", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save dataset revision", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Download generation inputs", exact: true }),
  ).toBeEnabled();
  const revisedId = new URL(page.url()).searchParams.get("dataset")!;
  expect(revisedId).not.toBe(saved.id);
  expect(
    (await (await request.get(`/api/evaluations/datasets/${saved.id}`)).json()).cases[0].as_of_date,
  ).toBe("2020-12-31");
  expect((await (await request.get(`/api/evaluations/datasets/${revisedId}`)).json()).version).toBe(
    2,
  );
});

test("reference form stores a development-only baseline", async ({ page, request }) => {
  const tag = crypto.randomUUID().slice(0, 8);
  await page.goto("/?view=evaluations");
  await page.getByRole("button", { name: "References", exact: true }).click();
  await page.getByLabel("Reference title", { exact: true }).fill(`Reference ${tag}`);
  await page.getByLabel("Author", { exact: true }).fill("Synthetic author");
  await page
    .getByRole("combobox", { name: "Reference origin", exact: true })
    .selectOption("synthetic");
  await page
    .getByLabel("Reference text", { exact: true })
    .fill(`A synthetic reference answer ${tag}, stored outside the generation evidence.`);
  await page.getByRole("button", { name: "Save reference", exact: true }).click();
  await expect(
    page.getByText(`Reference ${tag} Â· development only`, { exact: true }),
  ).toBeVisible();
  const refs = await (await request.get("/api/evaluations/references")).json();
  expect(
    refs.find((item: { title: string }) => item.title === `Reference ${tag}`).development_only,
  ).toBe(true);
});
