import { blankResearchBrief } from "../src/lib/research-sessions";
import { expect, test } from "./fixtures";

test("keyboard packet edits keep focus and announce the reading order at phone width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const capture = page.getByRole("form", { name: "Paste a source" });
  const packet = page.getByRole("region", { name: "Study packet" });
  const list = packet.getByRole("list", { name: "Pinned material" });
  const status = packet.getByRole("status");

  await capture.getByRole("button", { name: "Link", exact: true }).click();
  for (const title of ["Alpha weekly close", "Bravo follow-up", "Charlie reading"]) {
    await capture.getByLabel("Source title").fill(title);
    await capture
      .getByLabel("Original URL")
      .fill(`https://example.org/${title.toLowerCase().replaceAll(" ", "-")}`);
    await capture.getByRole("button", { name: "Pin link", exact: true }).click();
    await expect(list).toContainText(title);
  }

  const up = packet.getByRole("button", { name: "Move Bravo follow-up up", exact: true });
  const bounds = (await up.boundingBox())!;
  expect(bounds.width).toBeGreaterThanOrEqual(32);
  expect(bounds.height).toBeGreaterThanOrEqual(40);
  await up.focus();
  await page.keyboard.press("Enter");
  await expect(list.getByRole("listitem").first()).toContainText("Bravo follow-up");
  await expect(up).toBeFocused();
  await expect(up).toBeDisabled();
  await expect(status).toHaveText("Bravo follow-up moved to position 1 of 3.");
  await page.keyboard.press("Enter");
  await expect(list.getByRole("listitem").first()).toContainText("Bravo follow-up");
  await page.keyboard.press("Tab");
  await expect(packet.getByRole("button", { name: "Move Bravo follow-up down" })).toBeFocused();

  const unpinAll = packet.getByRole("button", { name: "Unpin all", exact: true });
  const undo = packet.getByRole("button", { name: "Undo unpin all", exact: true });
  const originalIds = await list
    .getByRole("link")
    .evaluateAll((links) =>
      links.map((link) => new URL((link as HTMLAnchorElement).href).searchParams.get("evidence")!),
    );
  const refreshedIds: string[] = [];
  await page.route("**/api/evidence/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (originalIds.includes(id)) refreshedIds.push(id);
    return route.continue();
  });
  await unpinAll.focus();
  await page.keyboard.press("Enter");
  await expect(list).toHaveCount(0);
  await expect(undo).toBeFocused();
  await expect(status).toHaveText("Unpinned 3 sources. Undo is available.");
  const library = page.getByRole("region", { name: "Source library" });
  const order = ["Bravo follow-up", "Alpha weekly close", "Charlie reading"];
  for (const title of order) {
    const source = library.getByRole("checkbox", { name: title });
    await expect(source).toBeVisible();
    await expect(source).not.toBeChecked();
  }
  await page.keyboard.press("Enter");
  await expect(list.getByRole("link")).toHaveCount(order.length);
  await expect(list.getByRole("link")).toContainText(order);
  await expect(status).toHaveText("Restored 3 sources in reading order.");
  await expect(unpinAll).toBeFocused();
  await expect(undo).toHaveCount(0);
  expect([...refreshedIds].sort()).toEqual([...originalIds].sort());

  const alpha = packet.getByRole("button", { name: "Unpin Alpha weekly close" });
  const bravo = packet.getByRole("button", { name: "Unpin Bravo follow-up" });
  const charlie = packet.getByRole("button", { name: "Unpin Charlie reading" });
  await alpha.focus();
  await page.keyboard.press("Space");
  await expect(charlie).toBeFocused();
  await expect(status).toHaveText("Unpinned Alpha weekly close. 2 sources in the packet.");
  await page.keyboard.press("Space");
  await expect(bravo).toBeFocused();
  await page.keyboard.press("Space");
  await expect(packet.getByRole("heading", { name: "Study packet" })).toBeFocused();
  await expect(status).toHaveText("Unpinned Bravo follow-up. 0 sources in the packet.");
  await expect(list).toHaveCount(0);
  const alphaId = originalIds[1]!;
  const reread = page.waitForRequest(`**/api/evidence/${alphaId}`);
  await library.getByRole("checkbox", { name: "Alpha weekly close" }).check();
  await reread;
  await expect(list.getByRole("link")).toContainText("Alpha weekly close");
  expect(refreshedIds.filter((id) => id === alphaId)).toHaveLength(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("move an exact source across the packet and submit the saved order", async ({
  ownerSession,
  page,
  request,
}) => {
  const sources = Array.from({ length: 8 }, (_, index) => ({
    id: crypto.randomUUID(),
    title: index >= 6 ? "Repeated chart caption" : `Source ${index + 1}`,
    kind: "text",
    rights: "owned",
    text: `Synthetic evidence record ${index + 1}.`,
  }));
  for (const source of sources) {
    expect((await request.post("/api/evidence", { data: source })).ok()).toBe(true);
  }
  const ids = sources.map((source) => source.id);
  await page.addInitScript(
    ({ key, draft }) => {
      if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify({ draft }));
    },
    {
      key: `${ownerSession.prefix}.research-brief.new`,
      draft: { ...blankResearchBrief, model: "test-model", evidence_ids: ids },
    },
  );
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  const packet = page.getByRole("region", { name: "Study packet" });
  const pinned = packet.getByRole("list", { name: "Pinned material" }).getByRole("link");
  await expect(pinned.last()).toContainText("Repeated chart caption");
  const summary = packet.getByText("Move a source", { exact: true });
  await summary.press("Enter");
  const form = packet.getByRole("form", { name: "Set reading order" });
  const source = form.getByRole("combobox", { name: "Source", exact: true });
  const position = form.getByRole("combobox", { name: "New position", exact: true });
  const move = form.getByRole("button", { name: "Move source", exact: true });
  await expect(move).toBeDisabled();
  await source.selectOption({ label: "8. Repeated chart caption" });
  await position.selectOption({ label: "1" });
  await move.press("Enter");
  await expect(pinned.first()).toBeFocused();
  await expect(pinned.first()).toHaveAttribute("href", new RegExp(ids[7]!));
  await expect(packet.getByRole("status")).toHaveText(
    "Repeated chart caption moved to position 1 of 8.",
  );
  await expect(position).toHaveValue("0");
  await expect(move).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const expected = [ids[7], ...ids.slice(0, -1)];
  await page.reload();
  await expect(pinned.first()).toHaveAttribute("href", new RegExp(ids[7]!));
  await expect(pinned.last()).toHaveAttribute("href", new RegExp(ids[6]!));
  await page.route("**/api/research-sessions", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 422, json: { detail: "Synthetic admission check." } })
      : route.continue(),
  );
  const submitted = page.waitForRequest(
    (item) => item.method() === "POST" && item.url().endsWith("/api/research-sessions"),
  );
  await page.getByRole("button", { name: "Ask the lead for a first reading" }).click();
  expect((await submitted).postDataJSON().evidence_ids).toEqual(expected);
});
