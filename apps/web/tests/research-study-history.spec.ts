import type { PendingReviewsPage } from "../src/lib/workflow";
import { pinDeskNote } from "./desk-material";
import { expect, test } from "./fixtures";

test("reopen a decision beyond recent research and find the study by a secondary source", async ({
  page,
  request,
}, info) => {
  const id = crypto.randomUUID();
  const title = `Credit spreads ${id.slice(0, 8)}`;
  const secondary = `Desk call notes ${id.slice(0, 8)}`;
  const sources = await Promise.all(
    [title, secondary].map(async (title) => {
      const source = await request.post("/api/evidence", {
        data: {
          id: crypto.randomUUID(),
          title,
          kind: "text",
          rights: "owned",
          text: "A synthetic observation about participation.",
        },
      });
      expect(source.ok()).toBeTruthy();
      return (await source.json()).id;
    }),
  );
  const catalog = await (await request.get("/api/providers/chatgpt")).json();
  const start = await request.post("/api/research-sessions", {
    data: {
      id,
      brief: "",
      start_from_sources: true,
      model: "test-model",
      provider_account_id: catalog.accounts[0].id,
      evidence_ids: sources,
    },
  });
  expect(start.status()).toBe(202);
  await expect
    .poll(
      async () => {
        const response = await request.get("/api/runs/reviews?sessions_only=true&limit=50");
        const result: PendingReviewsPage = await response.json();
        return result.items.find((item) => item.id === id)?.study_title;
      },
      { timeout: 45000 },
    )
    .toBe(title);

  await page.route("**/api/research-sessions", (route) =>
    route.fulfill({
      json: Array.from({ length: 20 }, (_, index) => ({
        id: crypto.randomUUID(),
        status: "completed",
        created_at: new Date().toISOString(),
        workflow_name: "Source-led research",
        brief_excerpt: `More recent study ${index + 1}`,
      })),
    }),
  );
  await page.route("**/api/runs/reviews?*", async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("sessions_only")).toBe("true");
    url.searchParams.set("limit", "50");
    const response = await route.fetch({ url: url.href });
    const result: PendingReviewsPage = await response.json();
    await route.fulfill({
      response,
      json: { items: result.items.filter((item) => item.id === id), has_more: false },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const pending = page.getByRole("complementary", { name: "Pending study decisions" });
  await expect(pending.getByRole("link", { name: title })).toBeVisible();
  const recent = page.getByRole("region", { name: "Recent research" });
  await expect(recent.getByRole("link", { name: /More recent study/ })).toHaveCount(20);
  await expect(recent.getByRole("link", { name: title })).toHaveCount(0);
  await recent.getByText("Search past studies", { exact: true }).click();
  await recent.getByRole("searchbox", { name: "Search the archive" }).fill(secondary);
  await recent.getByRole("button", { name: "Search", exact: true }).click();
  await expect(recent.getByRole("link", { name: new RegExp(title) })).toHaveAttribute(
    "href",
    `/?session=${id}`,
  );

  await pending.getByRole("link", { name: "View decision queue" }).click();
  await expect(page.getByRole("heading", { name: "Study decisions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.screenshot({ path: info.outputPath("study-decisions-phone.png") });
  await page.getByRole("link", { name: "Choose a working sentence" }).click();
  await expect(page).toHaveURL(/#source-led-investigation$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByRole("region", { name: "Source-led investigation" })).toBeFocused();
  await page.getByRole("button", { name: "Park this study" }).click();
  await expect(page.getByRole("heading", { name: "Study parked" })).toBeVisible();
  await page.getByRole("link", { name: "Decisions", exact: true }).click();
  await expect(page.getByText("No research studies are waiting for a decision.")).toBeVisible();
});

test("name a source-only study and carry the name into a revision", async ({ page }) => {
  const studyTitle = `Review of sector flows ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/");
  await pinDeskNote(page);
  const title = page.getByLabel("Study title (optional)");
  await title.fill(studyTitle);
  await page.reload();
  await expect(title).toHaveValue(studyTitle);
  await expect(page.getByLabel("Context for the lead (optional)")).toHaveValue("");
  await page.getByRole("button", { name: "Ask the lead for a first reading" }).click();
  await expect(page.getByRole("heading", { name: studyTitle, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Assign research" })).toBeVisible({
    timeout: 45000,
  });
  await page.getByRole("button", { name: "Revisit material" }).click();
  await expect(title).toHaveValue(studyTitle);
  await expect(page.getByLabel("Context for the lead (optional)")).toHaveValue("");
});
