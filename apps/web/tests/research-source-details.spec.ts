import { expect, test } from "./fixtures";

test("pasted sources use the shared attribution and explain when they need usage rights", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const details = page.getByRole("group", { name: "Source details", exact: true });
  const rights = details.getByLabel("Usage rights");
  const capture = page.getByRole("form", { name: "Paste a source" });
  const packet = page.getByRole("list", { name: "Pinned material" });

  await capture.getByRole("button", { name: "Link", exact: true }).click();
  await capture.getByLabel("Original URL").fill("https://example.org/synthetic-reference");
  await expect(rights).toHaveValue("unknown");
  await capture.getByRole("button", { name: "Pin link", exact: true }).click();
  await expect(packet).toContainText("Link only");

  await capture.getByRole("button", { name: "Conversation", exact: true }).click();
  await capture.getByLabel("Source title").fill("Synthetic desk call");
  await capture
    .getByLabel("Conversation excerpt")
    .fill("The second pricing check was inconclusive.");
  const pin = capture.getByRole("button", { name: "Pin conversation", exact: true });
  await expect(pin).toBeDisabled();
  await capture.getByRole("button", { name: "Select usage rights" }).click();
  await expect(rights).toBeFocused();
  await rights.selectOption("permission");
  await details.getByLabel("Author or speaker").fill("Synthetic participant");
  await details.getByLabel("As of").fill("2026-11-20");

  const saved = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/evidence",
  );
  await pin.click();
  expect((await saved).postDataJSON()).toMatchObject({
    title: "Synthetic desk call",
    kind: "discussion",
    rights: "permission",
    author: "Synthetic participant",
    as_of_date: "2026-11-20",
  });
  await expect(packet).toContainText("Synthetic desk call");
  await expect(packet).toContainText("Conversation · Synthetic participant · 2026-11-20");
});
