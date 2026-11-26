import { expect, test } from "./fixtures";

test("return from a first-reading citation to its exact proposal and keep the draft on a phone", async ({
  page,
  context,
}) => {
  const runId = crypto.randomUUID();
  const sourceId = crypto.randomUUID();
  const now = "2026-11-24T18:00:00Z";
  const sourceTitle = "Synthetic release note";
  const quote = "The first release and its revision use the same valuation date.";
  const proposals = ["Compare the first release.", "Start by comparing the revision."];
  const question = "Which release belongs in the comparison?";
  const checkpointId = crypto.randomUUID();
  const reviewId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const draft = "Compare both releases before choosing the series to use.";
  let archived = false;
  let submissions = 0;

  await context.route(`**/api/evidence/${sourceId}`, (route) =>
    route.fulfill({ json: { id: sourceId, title: sourceTitle, kind: "text" } }),
  );
  await context.route(`**/api/runs/${runId}/resume`, (route) => {
    submissions++;
    return route.fulfill({ status: 500 });
  });
  await context.route(`**/api/runs/${runId}`, (route) =>
    route.fulfill({
      json: {
        id: runId,
        brief: "Review archived release notes",
        created_at: now,
        status: archived ? "completed" : "paused",
        execution_pending: false,
        checkpoint_id: checkpointId,
        review: archived
          ? null
          : {
              node_id: "working_sentence",
              path: "root/working_sentence",
              interrupt_id: reviewId,
              question,
            },
        events: [],
        artifacts: [],
        evidence_ids: [sourceId],
        workflow: { nodes: [] },
        research_manifest: {
          settings: { model: "synthetic", limits: { max_model_calls: 20 } },
          tool_config: { session: "brief-led-1", discovery_version: "discovery-1" },
          evidence: [{ evidence_id: sourceId, original: null, representation: "original" }],
        },
        model_attempts: [
          {
            id: attemptId,
            status: "completed",
            path: "root/discovery",
            model: "synthetic",
            created_at: now,
            result: {
              limitations: [],
              discovery: {
                observation: "The releases have different values.",
                question,
                proposals: proposals.map((sentence) => ({
                  sentence,
                  alternative: "The difference may reflect the choice of series.",
                  first_check: "Check the dates in the release note.",
                  weaken_if: "Both series use the same value.",
                  evidence_ids: [sourceId],
                })),
                citations: [
                  {
                    evidence_id: sourceId,
                    relation: "context",
                    basis: "source_text",
                    locator: "Release note, paragraph 1",
                    quote,
                    rationale: "The note documents which dates are comparable.",
                  },
                ],
              },
            },
          },
        ],
      },
    }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?session=${runId}`);
  const sheet = page.getByRole("region", { name: "Source-led investigation" });
  const field = sheet.getByLabel("Your working sentence");
  const evidence = sheet.getByRole("complementary", { name: "Evidence behind the reading" });
  const article = evidence.getByRole("article", { name: sourceTitle });
  const back = article.getByRole("link", { name: "Return to proposal" });
  const citations = proposals.map((name) =>
    sheet.getByRole("article", { name }).getByRole("link", { name: sourceTitle }),
  );
  const sourceFragment = `#reading-source-${sourceId}`;
  await field.fill(draft);
  await expect(citations[0]!).toHaveAttribute("href", sourceFragment);
  await expect(back).toHaveCount(0);

  const [bookmarkTab] = await Promise.all([
    context.waitForEvent("page"),
    citations[0]!.click({ modifiers: ["ControlOrMeta"] }),
  ]);
  try {
    await expect(bookmarkTab).toHaveURL(new RegExp(`${sourceFragment}$`));
    await expect(bookmarkTab.getByRole("article", { name: sourceTitle })).toBeVisible();
    await expect(bookmarkTab.getByRole("link", { name: "Return to proposal" })).toHaveCount(0);
  } finally {
    await bookmarkTab.close();
  }
  expect(new URL(page.url()).hash).toBe("");
  await expect(back).toHaveCount(0);

  for (const citation of [...citations].reverse()) {
    await citation.press("Enter");
    await expect(article).toBeFocused();
    await expect(article.getByText(quote, { exact: true })).toBeVisible();
    expect(new URL(page.url()).hash).toBe(sourceFragment);
    await expect(back).toHaveAttribute("href", `#${await citation.getAttribute("id")}`);
    await back.press("Enter");
    await expect(citation).toBeFocused();
    await expect(field).toHaveValue(draft);
  }
  expect(submissions).toBe(0);

  archived = true;
  await page.goto(`/?session=${runId}${sourceFragment}`);
  await page.reload();
  await expect(article).toBeFocused();
  await expect(article.getByText(quote, { exact: true })).toBeVisible();
  await expect(back).toHaveCount(0);
});
