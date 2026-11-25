import { expect, test } from "./fixtures";

test("preview exact pinned charts in reading order without loading images ahead of time", async ({
  page,
}) => {
  const runId = crypto.randomUUID();
  const hash = (digit: string) => `sha256:${digit.repeat(64)}`;
  const sources = [
    { title: "First saved chart", id: crypto.randomUUID(), original: hash("a") },
    { title: "Changed source", id: crypto.randomUUID(), original: hash("b") },
    { title: "Missing source", id: crypto.randomUUID(), original: hash("d") },
    { title: "Unmatched artifact", id: crypto.randomUUID(), original: hash("e") },
    { title: "Unsupported original", id: crypto.randomUUID(), original: hash("1") },
    { title: "Last saved chart", id: crypto.randomUUID(), original: hash("2") },
  ] as const;
  const [first, changed, missing, unmatched, unsupported, last] = sources;
  const artifactReads: string[] = [];
  const detailReads: string[] = [];
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=",
    "base64",
  );
  await page.route("**/api/artifacts/*/content*", (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[3]!);
    artifactReads.push(id);
    return id === first.original || id === last.original
      ? route.fulfill({ contentType: "image/png", body: png })
      : route.fulfill({ status: 404 });
  });
  await page.route("**/api/evidence/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    detailReads.push(id);
    const source = sources.find((item) => item.id === id);
    if (!source || source === missing) return route.fulfill({ status: 404 });
    const original = source === changed ? hash("c") : source.original;
    return route.fulfill({
      json: {
        id,
        title: source.title,
        kind: "image",
        author: "Synthetic desk",
        availability: "available",
        as_of_date: "2026-11-23",
        content_hash: original,
        artifact: {
          id: source === unmatched ? hash("f") : original,
          media_type: source === unsupported ? "image/svg+xml" : "image/png",
        },
      },
    });
  });
  await page.route(`**/api/runs/${runId}`, (route) =>
    route.fulfill({
      json: {
        id: runId,
        brief: "Review the original chart packet",
        created_at: "2026-11-24T18:00:00Z",
        status: "completed",
        execution_pending: false,
        events: [],
        artifacts: sources.map(({ original, title }) => ({ id: original, name: `${title}.png` })),
        evidence_ids: sources.map(({ id }) => id),
        workflow: { nodes: [] },
        research_manifest: {
          settings: { model: "synthetic", limits: { max_model_calls: 24 } },
          tool_config: { session: "brief-led-1", discovery_version: "source-discovery-1" },
          evidence: sources.map(({ id, original }) => ({
            evidence_id: id,
            original,
            representation: "chart_screenshot",
            availability: "available",
            publisher: "Recorded publisher",
            as_of_date: "2026-11-20",
          })),
        },
        model_attempts: [],
      },
    }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?session=${runId}&workspace=lead`);
  const settings = page.getByText("Sources and settings", { exact: true });
  await expect(settings).toBeVisible();
  expect(detailReads).toEqual([]);
  expect(artifactReads).toEqual([]);
  await settings.press("Enter");
  const pinned = page.getByRole("region", { name: "Pinned study sources" });
  const previews = pinned.getByRole("button", { name: /^Preview chart / });
  await expect(previews).toHaveCount(2);
  await expect(pinned.getByText("Source record differs from the pinned original.")).toBeVisible();
  await expect(pinned.getByText("Saved snapshot · Source record unavailable")).toBeVisible();
  await expect(pinned.getByRole("link", { name: unmatched.title, exact: true })).toBeVisible();
  await expect(pinned.getByRole("link", { name: unsupported.title, exact: true })).toBeVisible();
  expect([...detailReads].sort()).toEqual(sources.map(({ id }) => id).sort());
  expect(artifactReads).toEqual([]);

  const opener = pinned.getByRole("button", { name: `Preview chart ${first.title}` });
  await opener.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName(first.title);
  await expect(dialog).toHaveAccessibleDescription(
    "Chart 1 of 2 · Synthetic desk · As of 2026-11-20",
  );
  const image = dialog.getByRole("img", { name: first.title });
  await expect(image).toHaveAttribute(
    "src",
    new URL(`/api/artifacts/${encodeURIComponent(first.original)}/content`, page.url()).href,
  );
  await expect.poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1);
  expect(artifactReads).toEqual([first.original]);

  await dialog.getByRole("button", { name: "Next chart" }).press("Enter");
  await expect(dialog).toHaveAccessibleName(last.title);
  await expect(dialog.getByRole("link", { name: "Open source record" })).toHaveAttribute(
    "href",
    `/?view=evidence&evidence=${last.id}`,
  );
  await expect(dialog.getByRole("img", { name: last.title })).toBeVisible();
  await expect.poll(() => artifactReads).toEqual([first.original, last.original]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  expect(detailReads).toHaveLength(sources.length);
  expect(new URL(page.url()).searchParams.get("session")).toBe(runId);
});
