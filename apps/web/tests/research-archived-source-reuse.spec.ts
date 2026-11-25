import { pinDeskNote } from "./desk-material";
import { expect, test, type Page } from "./fixtures";

async function archiveFixture(page: Page) {
  const runId = crypto.randomUUID();
  const title = "Saved inventory observations";
  const now = "2026-11-24T13:04:00Z";
  const [original, different, oversized] = [
    ["Archived inventory note", "a"],
    ["Changed inventory note", "b"],
    ["Large archived extract", "c"],
  ].map(([title, digit]) => ({
    id: crypto.randomUUID(),
    title,
    content_hash: `sha256:${digit!.repeat(64)}`,
    kind: "text",
    representation: "original",
    availability: "available",
    publisher: "Synthetic data series",
    as_of_date: "2026-11-20",
    source_url: null,
  }));
  const records = [
    original!,
    { ...different!, content_hash: `sha256:${"d".repeat(64)}` },
    {
      ...oversized!,
      artifact: {
        id: oversized!.content_hash,
        name: "observations.csv",
        media_type: "text/csv",
        byte_size: 9_000_000,
      },
    },
  ];
  await page.route("**/api/runs/search?*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            run: {
              id: runId,
              revision_id: crypto.randomUUID(),
              revision_number: 1,
              workflow_name: "Research session",
              study_title: title,
              status: "completed",
              created_at: now,
            },
          },
        ],
        has_more: false,
      },
    }),
  );
  await page.route(`**/api/runs/${runId}`, (route) =>
    route.fulfill({
      json: {
        id: runId,
        brief: "Saved first reading",
        study_title: title,
        created_at: now,
        status: "completed",
        execution_pending: false,
        events: [],
        artifacts: [],
        evidence_ids: records.map(({ id }) => id),
        workflow: { nodes: [] },
        research_manifest: {
          settings: { model: "test-model", limits: { max_model_calls: 30 } },
          tool_config: { session: "brief-led-1", discovery_version: "source-discovery-1" },
          evidence: [original!, different!, oversized!].map((record) => ({
            evidence_id: record.id,
            original: record.content_hash,
            representation: record.representation,
            availability: record.availability,
            publisher: record.publisher,
            as_of_date: record.as_of_date,
            source_url: record.source_url,
          })),
        },
      },
    }),
  );
  for (const record of records) {
    await page.route(`**/api/evidence/${record.id}`, (route) => route.fulfill({ json: record }));
  }
  return { runId, title, original: original!, different: different!, oversized: oversized! };
}

async function openArchiveStudy(page: Page, title: string) {
  await page.getByRole("link", { name: "Studies", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search the archive" });
  await search.fill("inventory");
  await search.press("Enter");
  await page
    .getByRole("list", { name: "Saved studies" })
    .getByRole("link", { name: new RegExp(title) })
    .click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
}

function addSource(page: Page, title: string) {
  return page.getByRole("button", { name: `Add ${title} to study setup and return`, exact: true });
}

test("append the exact archived source to the open setup once", async ({ page }) => {
  const { runId, title, original, different, oversized } = await archiveFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const firstPin = await pinDeskNote(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      request.method() === "POST" &&
      ["/api/research-sessions", "/api/evidence", "/api/artifacts"].includes(path)
    )
      writes.push(path);
  });
  const draftTitle = page.getByLabel("Study title (optional)", { exact: true });
  await draftTitle.fill("Next week's study");
  await page.getByLabel("Source files").setInputFiles({
    name: "new-observations.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic observations from the current week."),
  });
  const queuedTitle = page.getByLabel("Packet title for new-observations.txt");
  await queuedTitle.fill("New observations in progress");

  await openArchiveStudy(page, title);
  const settings = page.getByText("Sources and settings", { exact: true });
  await settings.click();
  await expect(page.getByText("Source record differs from the pinned original.")).toBeVisible();
  await expect(addSource(page, different.title!)).toHaveCount(0);
  await addSource(page, original.title!).click();

  const packetHeading = page.getByRole("heading", { name: "Study packet", exact: true });
  const packet = page.getByRole("list", { name: "Pinned material", exact: true });
  const rows = packet.getByRole("listitem");
  await expect(packetHeading).toBeFocused();
  await expect(page.getByText(`Added ${original.title} to the study packet.`)).toBeVisible();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByRole("link")).toHaveAttribute(
    "href",
    `/?view=evidence&evidence=${firstPin}`,
  );
  await expect(rows.nth(1).getByRole("link", { name: original.title! })).toHaveAttribute(
    "href",
    `/?view=evidence&evidence=${original.id}`,
  );
  await expect(draftTitle).toHaveValue("Next week's study");
  await expect(queuedTitle).toHaveValue("New observations in progress");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`session=${runId}`));
  await settings.click();
  await addSource(page, original.title!).click();
  await expect(page.getByText(`${original.title} is already in the study packet.`)).toBeVisible();
  await expect(rows).toHaveCount(2);

  await page.goBack();
  await settings.click();
  await addSource(page, oversized.title!).click();
  await expect(
    page.getByText(
      "The source content fills the request limit. Unpin files to leave room for the lead’s instructions.",
    ),
  ).toBeVisible();
  await expect(rows).toHaveCount(2);

  await page
    .getByRole("button", { name: "Remove queued new-observations.txt", exact: true })
    .click();
  await packet.getByRole("button", { name: `Unpin ${original.title}`, exact: true }).click();
  await expect(rows).toHaveCount(1);
  await page.goBack();
  await page.goForward();
  await expect(rows).toHaveCount(1);
  await page.goBack();
  await page.goBack();
  await expect(page.getByRole("searchbox", { name: "Search the archive" })).toHaveValue(
    "inventory",
  );
  expect(writes).toEqual([]);

  await page.goto(`/?session=${runId}`);
  await settings.click();
  await expect(page.getByRole("link", { name: original.title!, exact: true })).toBeVisible();
  await expect(addSource(page, original.title!)).toHaveCount(0);
});

test("keep a pending start's exact packet while browsing archived sources", async ({ page }) => {
  const { title, original } = await archiveFixture(page);
  const pending = Promise.withResolvers<string[]>();
  const release = Promise.withResolvers<void>();
  await page.route("**/api/research-sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    pending.resolve(route.request().postDataJSON().evidence_ids as string[]);
    await release.promise;
    await route.fulfill({ status: 422, json: { detail: "Synthetic start captured." } });
  });

  try {
    await page.goto("/");
    const firstPin = await pinDeskNote(page);
    await page.getByRole("button", { name: "Ask the lead for a first reading" }).click();
    expect(await pending.promise).toEqual([firstPin]);
    await openArchiveStudy(page, title);
    await page.getByText("Sources and settings", { exact: true }).click();
    await addSource(page, original.title!).click();
    await expect(
      page.getByText(
        "The study setup is busy. Try adding the source after the current request settles.",
      ),
    ).toBeVisible();
    const rows = page
      .getByRole("list", { name: "Pinned material", exact: true })
      .getByRole("listitem");
    await expect(rows).toHaveCount(1);
    release.resolve();
    await expect(page.getByText("Synthetic start captured.", { exact: true })).toBeVisible();
    await expect(rows).toHaveCount(1);
  } finally {
    release.resolve();
  }
});
