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
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
