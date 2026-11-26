import { expect, test } from "./fixtures";
import { pinDeskNote } from "./desk-material";

test("the tab keeps separate unsent captures for new and revisited studies", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const previous = crypto.randomUUID();
  await page.route(`**/api/research-sessions/${previous}/setup`, (route) =>
    route.fulfill({
      json: { model: "test-model", brief: "Restore this study", evidence_ids: [] },
    }),
  );
  await page.goto("/");
  await pinDeskNote(page);
  const capture = page.getByRole("form", { name: "Paste a source" });
  const start = page.getByRole("button", { name: "Ask the lead for a first reading", exact: true });
  await expect(start).toBeEnabled();
  await page.getByLabel("Usage rights").selectOption("permission");
  await page.getByLabel("Author or speaker").fill("First desk participant");
  await page.getByLabel("As of").fill("2026-11-19");
  await capture.getByRole("button", { name: "Conversation", exact: true }).click();
  await capture.getByLabel("Source title").fill("Unsent desk conversation");
  await capture.getByLabel("Conversation excerpt").fill("Observation from the synthetic desk.");
  await page.getByLabel("Source files").setInputFiles({
    name: "unstored-file.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("This file needs to be chosen again after reload."),
  });
  await expect(page.getByRole("list", { name: "Files to pin" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("list", { name: "Files to pin" })).toHaveCount(0);
  await expect(capture.getByLabel("Conversation excerpt")).toHaveValue(
    "Observation from the synthetic desk.",
  );
  await expect(start).toBeDisabled();

  const revisit = `/?fromSession=${previous}`;
  await page.goto(revisit);
  await expect(page.getByLabel("Context for the lead (optional)")).toHaveValue(
    "Restore this study",
  );
  await expect(capture.getByLabel("Note text")).toHaveValue("");
  await expect(page.getByLabel("Usage rights")).toHaveValue("unknown");
  await page.getByLabel("Author or speaker").fill("Second desk participant");
  await capture.getByRole("button", { name: "Link", exact: true }).click();
  await capture.getByLabel("Original URL").fill("https://example.org/unsent-reference");
  await page.reload();
  await expect(capture.getByLabel("Original URL")).toHaveValue(
    "https://example.org/unsent-reference",
  );
  await expect(page.getByLabel("Author or speaker")).toHaveValue("Second desk participant");

  await page.goto("/");
  await expect(capture.getByLabel("Source title")).toHaveValue("Unsent desk conversation");
  await expect(page.getByLabel("Usage rights")).toHaveValue("permission");
  await expect(page.getByLabel("Author or speaker")).toHaveValue("First desk participant");
  await expect(page.getByLabel("As of")).toHaveValue("2026-11-19");
  await capture.getByRole("button", { name: "Clear entry" }).click();
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page).toHaveURL(/\?session=/);
  await page.goto("/");
  await expect(page.getByLabel("Usage rights")).toHaveValue("unknown");
  await expect(page.getByLabel("Author or speaker")).toHaveValue("");
  await page.goto(revisit);
  await expect(capture.getByLabel("Original URL")).toHaveValue(
    "https://example.org/unsent-reference",
  );
  await expect(page.getByLabel("Author or speaker")).toHaveValue("Second desk participant");
});

test("retry an unconfirmed pasted source after reload with the exact original request", async ({
  page,
}) => {
  const sourceTitle = `Unconfirmed desk note ${crypto.randomUUID()}`;
  const attempts: string[] = [];
  await page.route("**/api/evidence", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || request.postDataJSON().title !== sourceTitle)
      return route.continue();
    attempts.push(request.postData()!);
    if (attempts.length === 1) {
      expect((await route.fetch()).status()).toBe(201);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto("/");
  const rights = page.getByLabel("Usage rights");
  const author = page.getByLabel("Author or speaker");
  await rights.selectOption("owned");
  await author.fill("Synthetic desk");
  const capture = page.getByRole("form", { name: "Paste a source" });
  await capture.getByLabel("Source title").fill(sourceTitle);
  await capture.getByLabel("Note text").fill("The receipt from this synthetic capture was lost.");
  await capture.getByRole("button", { name: "Pin note", exact: true }).click();
  const retry = capture.getByRole("button", { name: "Retry pin note", exact: true });
  await expect(retry).toBeVisible();
  await page.reload();
  await expect(capture.getByLabel("Source title")).toHaveValue(sourceTitle);
  await expect(retry).toBeEnabled();
  await retry.click();

  const packet = page.getByRole("list", { name: "Pinned material" });
  await expect(packet.getByRole("listitem")).toHaveCount(1);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toBe(attempts[0]);
  await expect(capture.getByLabel("Note text")).toHaveValue("");
  await page.reload();
  await expect(packet.getByRole("listitem")).toHaveCount(1);
  await expect(capture.getByLabel("Source title")).toHaveValue("");
  await expect(rights).toHaveValue("owned");
  await expect(author).toHaveValue("Synthetic desk");
  await expect(retry).toHaveCount(0);
});
