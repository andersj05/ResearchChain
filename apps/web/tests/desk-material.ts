import { expect, type Page } from "./fixtures";

export async function pinDeskNote(page: Page) {
  const title = `Desk note ${crypto.randomUUID()}`;
  await page.getByLabel("Usage rights").selectOption("owned");
  const capture = page.getByRole("form", { name: "Paste a source" });
  await capture.getByLabel("Source title").fill(title);
  await capture.getByLabel("Note text").fill("Synthetic weekly observations for the test study.");
  const response = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/evidence",
  );
  await capture.getByRole("button", { name: "Pin note" }).click();
  await expect(page.getByRole("list", { name: "Pinned material" })).toContainText(title);
  return (await (await response).json()).id as string;
}

export async function commissionDeskStudy(page: Page, sentence: string) {
  const field = page.getByLabel("Your working sentence");
  await expect(field).toBeVisible({ timeout: 60_000 });
  await field.fill(sentence);
  await page.getByRole("button", { name: "Assign research", exact: true }).click();
}
