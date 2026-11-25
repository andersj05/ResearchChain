import { expect, test } from "./fixtures";

test("paste a screenshot on the desk, name it and pin it without saving a file", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const note = page.getByLabel("Note text");
  const queue = page.getByRole("list", { name: "Files to pin" });
  const pasteScreenshot = async (target: typeof note) => {
    return target.evaluate(async (element) => {
      const canvas = document.createElement("canvas");
      canvas.width = 50;
      canvas.height = 20;
      const drawing = canvas.getContext("2d")!;
      drawing.fillStyle = "#eee";
      drawing.fillRect(0, 0, 50, 20);
      drawing.fillStyle = "#444";
      drawing.fillRect(4, 6, 42, 2);
      const image = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!)));
      const clipboardData = new DataTransfer();
      clipboardData.items.add(new File([image], "screenshot", { type: "image/png" }));
      clipboardData.setData("text/plain", "A synthetic desk observation");
      return element.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
      );
    });
  };

  await note.focus();
  expect(await pasteScreenshot(note)).toBe(true);
  await expect(queue).toHaveCount(0);

  const drop = page.getByRole("button", { name: /Drop files or browse/ });
  await drop.focus();
  expect(await pasteScreenshot(drop)).toBe(false);
  const title = queue.getByRole("textbox", { name: "Packet title for clipboard.png" });
  await expect(title).toHaveValue("Pasted chart 1");
  await title.fill("Synthetic yield curve, Friday close");
  const pin = page.getByRole("button", { name: "Pin 1 file", exact: true });
  await expect(pin).toBeDisabled();
  await page.getByLabel("Usage rights").selectOption("owned");
  await pin.click();
  const packet = page.getByRole("list", { name: "Pinned material" });
  await expect(packet.getByText("Synthetic yield curve, Friday close")).toBeVisible();
  await expect(
    packet.getByRole("button", { name: "Preview chart Synthetic yield curve, Friday close" }),
  ).toBeVisible();
  await expect(queue).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
