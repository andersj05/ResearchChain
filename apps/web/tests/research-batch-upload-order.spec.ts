import type { EvidenceInput } from "../src/lib/evidence";
import { expect, test } from "./fixtures";

test("overlap originals, preserve pin order, and retry only the failed operation", async ({
  page,
}) => {
  const first = "first-release.csv";
  const lostPin = "second-note.txt";
  const duplicate = "same-original.txt";
  const failedUpload = "retry-original.txt";
  const last = "last-note.txt";
  const holdFirstUpload = Promise.withResolvers<void>();
  const uploads: string[] = [];
  const uploaded: string[] = [];
  const posts: { raw: string; body: EvidenceInput }[] = [];
  const originals = new Map<string, { id: string; name: string; media_type: string }>();
  await page.route("**/api/artifacts?*", async (route) => {
    const name = new URL(route.request().url()).searchParams.get("name")!;
    uploads.push(name);
    if (name === first) await holdFirstUpload.promise;
    if (name === failedUpload && uploads.filter((file) => file === name).length === 1)
      return route.fulfill({ status: 503, json: { detail: "Retry this original upload." } });
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    originals.set(name, await response.json());
    await route.fulfill({ response });
    uploaded.push(name);
  });
  await page.route("**/api/evidence", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body: EvidenceInput = route.request().postDataJSON();
    posts.push({ body, raw: route.request().postData()! });
    if (
      body.title === lostPin &&
      posts.filter((post) => post.body.title === lostPin).length === 1
    ) {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      return route.fulfill({
        status: 201,
        json: { ...(await response.json()), id: crypto.randomUUID() },
      });
    }
    return route.continue();
  });

  const token = crypto.randomUUID();
  const csv = Buffer.from(`period,value\n${token},4\n`);
  await page.goto("/");
  await page.getByLabel("Usage rights").selectOption("owned");
  const author = page.getByLabel("Author or speaker");
  const date = page.getByLabel("As of", { exact: true });
  await author.fill("Synthetic original author");
  await date.fill("2026-11-20");
  const files = [
    { name: first, mimeType: "text/csv", buffer: csv },
    { name: lostPin, mimeType: "text/plain", buffer: Buffer.from(`A separate note ${token}.`) },
    { name: duplicate, mimeType: "text/plain", buffer: csv },
    {
      name: failedUpload,
      mimeType: "text/plain",
      buffer: Buffer.from(`A retriable original document ${token}.`),
    },
    {
      name: last,
      mimeType: "text/plain",
      buffer: Buffer.from(`A saved longer last note in the batch ${token}.`),
    },
  ];
  expect(new Set(files.map(({ buffer }) => buffer.length)).size).toBe(4);
  await page.getByLabel("Source files").setInputFiles(files);
  const packet = page.getByRole("list", { name: "Pinned material" }).getByRole("listitem");
  const incoming = page.getByRole("list", { name: "Files to pin" });
  await page.getByRole("button", { name: "Pin 5 files", exact: true }).click();
  try {
    await expect.poll(() => uploaded).toEqual([lostPin]);
    expect([...uploads].sort()).toEqual([first, lostPin].sort());
    expect(posts).toEqual([]);
    await expect(packet).toHaveCount(0);
  } finally {
    holdFirstUpload.resolve();
  }

  await expect(page.getByText("3 files pinned. 2 still queued.")).toBeVisible();
  await expect(packet).toHaveCount(3);
  await expect(packet).toContainText([first, duplicate, last]);
  await expect(incoming.getByText("The server returned a different source record.")).toBeVisible();
  await expect(incoming.getByText("Retry this original upload.")).toBeVisible();
  await expect(incoming.getByLabel(`Packet title for ${lostPin}`, { exact: true })).toBeDisabled();
  await expect(
    incoming.getByLabel(`Packet title for ${failedUpload}`, { exact: true }),
  ).toBeEditable();
  expect(originals.get(duplicate)).toEqual(originals.get(first));
  expect(originals.get(duplicate)).toMatchObject({ name: first, media_type: "text/csv" });
  expect(posts.map(({ body }) => body.title)).toEqual([first, lostPin, duplicate, last]);
  expect(uploads).toHaveLength(5);

  await author.fill("Synthetic corrected author");
  await date.fill("2026-11-23");
  await page.getByRole("button", { name: "Pin 2 files", exact: true }).click();
  await expect(page.getByText("2 files pinned.", { exact: true })).toBeVisible();
  await expect(packet).toHaveCount(5);
  await expect(packet).toContainText([first, duplicate, last, lostPin, failedUpload]);
  expect(posts.map(({ body }) => body.title)).toEqual([
    first,
    lostPin,
    duplicate,
    last,
    lostPin,
    failedUpload,
  ]);
  expect(posts[4]?.raw).toBe(posts[1]?.raw);
  expect(posts[4]?.body).toMatchObject({
    author: "Synthetic original author",
    as_of_date: "2026-11-20",
  });
  expect(posts[5]?.body).toMatchObject({
    author: "Synthetic corrected author",
    as_of_date: "2026-11-23",
  });
  expect(uploads).toHaveLength(6);
  expect(uploads.at(-1)).toBe(failedUpload);
});
