import { expect, test } from "./fixtures";

test("a phone gives queued transcript titles room and follows the visible desk order", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  const capture = page.getByRole("region", { name: "Add material" });
  const packet = page.getByRole("complementary", { name: "Prepare the first reading" });
  const list = packet.getByRole("list", { name: "Pinned material" });
  const library = page.getByRole("region", { name: "Source library" });

  await capture.getByLabel("Usage rights").selectOption("owned");
  const author = "W".repeat(80);
  await capture.getByLabel("Author or speaker").fill(author);
  await capture.getByLabel("Source files").setInputFiles({
    name: "friday-call.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic participant: we checked the Friday prices."),
  });
  const title = capture.getByRole("textbox", { name: "Packet title for friday-call.txt" });
  const type = capture.getByLabel("Type for friday-call.txt");
  await expect(title).toBeVisible();
  await expect(type).toBeVisible();
  expect((await title.boundingBox())!.width).toBeGreaterThanOrEqual(100);
  expect((await type.boundingBox())!.width).toBeGreaterThanOrEqual(80);
  const customTitle = `Synthetic Friday call transcript ${"W".repeat(80)}`;
  await title.fill(customTitle);
  await type.selectOption("discussion");
  await capture.getByRole("button", { name: "Pin 1 file", exact: true }).click();
  const pinned = packet.getByRole("link", { name: /Synthetic Friday call transcript/ });
  await expect(pinned).toContainText(customTitle);
  await expect(pinned).toContainText(`Conversation · ${author}`);
  expect(await list.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  await capture.getByLabel("Note text").focus();
  await page.keyboard.press("Tab");
  await expect(pinned).toBeFocused();
  const account = packet.getByRole("button", { name: /^ChatGPT plan/ });
  await account.focus();
  await page.keyboard.press("Tab");
  await expect(packet.getByRole("link", { name: "Change research settings" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(library.getByRole("searchbox")).toBeFocused();
  expect((await packet.boundingBox())!.y).toBeLessThan((await library.boundingBox())!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const captureBox = (await capture.boundingBox())!;
  const packetBox = (await packet.boundingBox())!;
  const libraryBox = (await library.boundingBox())!;
  expect(packetBox.x).toBeGreaterThan(captureBox.x + captureBox.width);
  expect(packetBox.y).toBeCloseTo(captureBox.y, 0);
  expect(libraryBox.x).toBeCloseTo(captureBox.x, 0);
  expect(libraryBox.y).toBeGreaterThan(captureBox.y + captureBox.height);
  expect(await packet.evaluate((element) => getComputedStyle(element).position)).toBe("sticky");
});
