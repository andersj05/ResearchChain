import { expect, test } from "./fixtures";

test("keep per-file attribution and unchanged batch defaults through a partial pin retry", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const names = ["regional-call.txt", "levels.csv", "unverified-date.txt"];
  const posted: { id: string; title: string; author: string; as_of_date: string | null }[] = [];
  await page.route("**/api/evidence", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON();
    if (!names.includes(body.title)) return route.continue();
    posted.push(body);
    if (body.title === names[0] && posted.filter(({ title }) => title === names[0]).length === 1) {
      expect((await route.fetch()).status()).toBe(201);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto("/");
  const batch = page.getByRole("group", { name: "Source details", exact: true });
  await batch.getByLabel("Usage rights").selectOption("owned");
  await batch.getByLabel("Author or speaker").fill("Batch desk");
  await batch.getByLabel("As of", { exact: true }).fill("2026-11-20");
  await page.getByLabel("Source files").setInputFiles([
    { name: names[0]!, mimeType: "text/plain", buffer: Buffer.from("Synthetic meeting notes.") },
    { name: names[1]!, mimeType: "text/csv", buffer: Buffer.from("period,value\n1,4\n") },
    { name: names[2]!, mimeType: "text/plain", buffer: Buffer.from("Synthetic dated note.") },
  ]);
  const queue = page.getByRole("list", { name: "Files to pin" });
  const fileRow = (name: string) =>
    queue.getByRole("listitem").filter({
      has: page.getByLabel(`Packet title for ${name}`, { exact: true }),
    });
  const call = fileRow(names[0]!);
  const author = call.getByLabel("Author / speaker", { exact: true });
  const date = call.getByLabel("As-of date", { exact: true });
  await expect(author).toBeHidden();
  await call.locator("summary").click();
  await expect(author).toHaveValue("Batch desk");
  await expect(date).toHaveValue("2026-11-20");
  await author.fill("Regional researcher");
  await date.fill("2026-11-19");

  const unverified = fileRow(names[2]!);
  await unverified.locator("summary").click();
  await unverified.getByLabel("Author / speaker", { exact: true }).fill("Temporary override");
  await unverified.getByRole("button", { name: "Use batch author and date" }).click();
  await unverified.getByLabel("As-of date", { exact: true }).fill("");
  await batch.getByLabel("Author or speaker").fill("Updated batch desk");
  await batch.getByLabel("As of", { exact: true }).fill("2026-11-21");
  await expect(unverified.getByLabel("Author / speaker", { exact: true })).toHaveValue(
    "Updated batch desk",
  );
  await expect(unverified.getByLabel("As-of date", { exact: true })).toHaveValue("");
  await expect(author).toHaveValue("Regional researcher");
  await expect(date).toHaveValue("2026-11-19");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.getByRole("button", { name: "Pin 3 files", exact: true }).click();
  const packet = page.getByRole("list", { name: "Pinned material" });
  await expect(packet.getByRole("listitem")).toHaveCount(2);
  await expect(queue.getByRole("listitem")).toHaveCount(1);
  await expect(
    call.getByText("Retry keeps the author and date from this file’s first request."),
  ).toBeVisible();
  await expect(author).toBeDisabled();
  await expect(date).toBeDisabled();
  await batch.getByLabel("Author or speaker").fill("Batch changed after the receipt");
  await batch.getByLabel("As of", { exact: true }).fill("2026-11-22");
  await expect(author).toHaveValue("Regional researcher");
  await expect(date).toHaveValue("2026-11-19");
  await page.getByRole("button", { name: "Pin 1 file", exact: true }).click();
  await expect(packet.getByRole("listitem")).toHaveCount(3);
  expect(posted.map(({ title }) => title)).toEqual([...names, names[0]]);
  expect(posted.at(-1)).toEqual(posted[0]);
  expect(posted[0]).toMatchObject({ author: "Regional researcher", as_of_date: "2026-11-19" });
  expect(posted[1]).toMatchObject({ author: "Updated batch desk", as_of_date: "2026-11-21" });
  expect(posted[2]).toMatchObject({ author: "Updated batch desk", as_of_date: null });
  const saved = await request.get(`/api/evidence/${posted[0]!.id}`);
  expect(saved.status()).toBe(200);
  expect(await saved.json()).toMatchObject({
    id: posted[0]!.id,
    author: "Regional researcher",
    as_of_date: "2026-11-19",
    rights: "owned",
  });
});
