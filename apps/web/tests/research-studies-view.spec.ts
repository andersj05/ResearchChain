import { expect, test } from "./fixtures";

test("open studies directly, without loading new-study data or losing its draft", async ({
  page,
}) => {
  const id = crypto.randomUUID();
  const providerReads: string[] = [];
  const draftReads: string[] = [];
  const archiveReads: URLSearchParams[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") return;
    const url = new URL(request.url());
    if (url.pathname === "/api/providers/chatgpt") providerReads.push(url.pathname);
    if (["/api/research-sessions", "/api/runs/reviews", "/api/evidence"].includes(url.pathname))
      draftReads.push(url.pathname);
    if (url.pathname === "/api/runs/search") archiveReads.push(url.searchParams);
  });
  await page.route("**/api/runs/search?*", (route) => {
    const search = new URL(route.request().url()).searchParams.get("search");
    return route.fulfill({
      json: {
        items: search
          ? [
              {
                run: {
                  id,
                  revision_id: crypto.randomUUID(),
                  revision_number: 1,
                  workflow_name: "Research session",
                  study_title: "Archived curves and credit vintages",
                  status: "completed",
                  created_at: "2026-11-24T13:04:00Z",
                },
                brief_excerpt: "Synthetic setup for a past research experiment.",
              },
            ]
          : [],
        has_more: false,
      },
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=research&studies=1");
  const navigation = page.getByRole("navigation", { name: "Research navigation" });
  const studies = navigation.getByRole("link", { name: "Studies", exact: true });
  const search = page.getByRole("searchbox", { name: "Search the archive" });
  await expect(page.getByRole("heading", { name: "Studies", level: 1 })).toBeVisible();
  await expect(studies).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "New study", exact: true })).toHaveCount(0);
  await expect(page.getByText("No saved studies yet.")).toBeVisible();
  await search.fill("credit vintages");
  await search.press("Enter");
  const result = page
    .getByRole("list", { name: "Saved studies" })
    .getByRole("link", { name: /Archived curves and credit vintages/ });
  await expect(result).toHaveAttribute("href", `/?session=${id}`);
  expect(archiveReads.map((params) => params.get("sessions_only"))).toEqual(["true", "true"]);
  expect(draftReads).toEqual([]);
  expect(providerReads).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const home = page.getByRole("link", { name: "New study", exact: true });
  await home.click();
  const title = page.getByRole("textbox", { name: "Study title (optional)" });
  await title.fill("Unsaved research title");
  await studies.press("Enter");
  await expect(result).toBeVisible();
  await expect(search).toHaveValue("credit vintages");
  await home.click();
  await expect(title).toHaveValue("Unsaved research title");
});
