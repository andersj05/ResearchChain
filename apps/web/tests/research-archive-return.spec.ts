import type { RunArchivePage } from "../src/lib/workflow";
import { expect, test } from "./fixtures";

type ArchiveItem = RunArchivePage["items"][number];

test("returns to the submitted study archive page and can reset or recover it", async ({
  page,
  ownerSession,
}) => {
  const searchTerm = "credit vintages";
  const storageKey = `${ownerSession.prefix}.research.archive.v1`;
  function study(
    title: string,
    createdAt: string,
    status: ArchiveItem["run"]["status"],
  ): ArchiveItem {
    return {
      run: {
        id: crypto.randomUUID(),
        revision_id: crypto.randomUUID(),
        revision_number: 1,
        workflow_name: "Source-led research",
        study_title: title,
        status,
        created_at: createdAt,
      },
      brief_excerpt: `Synthetic notes for ${title.toLowerCase()}.`,
    };
  }
  const recent = study("Current credit review", "2026-11-24T15:06:10.123456Z", "completed");
  const archived = study("Archived curve check", "2026-11-20T13:05:00Z", "completed");
  const waiting = study("Waiting on a decision", "2026-11-21T13:05:00Z", "paused");
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "researchchain.owner.another-workspace.another-owner.research.archive.v1",
      JSON.stringify({
        open: true,
        search: "Different owner's search",
        status: "paused",
        cursors: [],
      }),
    );
  });
  await page.route("**/api/research-sessions", (route) =>
    route.fulfill({ json: [{ ...recent.run, brief_excerpt: recent.brief_excerpt }] }),
  );
  await page.route(`**/api/runs/${archived.run.id}`, (route) =>
    route.fulfill({
      json: {
        ...archived.run,
        brief: archived.brief_excerpt,
        execution_pending: false,
        events: [],
        artifacts: [],
        evidence_ids: [],
        workflow: { nodes: [] },
        research_manifest: {
          settings: { model: "synthetic", limits: { max_model_calls: 30 } },
          evidence: [],
          tool_config: { session: "brief-led-1" },
        },
      },
    }),
  );
  let archivePageMissing = false;
  let lastQuery: URLSearchParams | undefined;
  await page.route("**/api/runs/search?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    lastQuery = params;
    expect(params.get("sessions_only")).toBe("true");
    if (params.get("before_id")) {
      expect(params.get("before_id")).toBe(recent.run.id);
      expect(params.get("before_created_at")).toBe(recent.run.created_at);
      return route.fulfill({
        json: { items: archivePageMissing ? [] : [archived], has_more: false },
      });
    }
    if (params.get("status") === "paused")
      return route.fulfill({ json: { items: [waiting], has_more: false } });
    return route.fulfill({ json: { items: [recent], has_more: true } });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const history = page.getByRole("region", { name: "Recent research" });
  const search = history.getByRole("searchbox", { name: "Search the archive" });
  const status = history.getByRole("combobox", { name: "Study status" });
  const submit = history.getByRole("button", { name: "Search", exact: true });
  const reset = history.getByRole("button", { name: "Reset search" });
  const next = history.getByRole("button", { name: "Next page" });
  const results = history.getByRole("list", { name: "Saved studies" });
  const archivedLink = results.getByRole("link", { name: /Archived curve check/ });
  await expect(search).toBeHidden();
  await history.getByText("Search past studies", { exact: true }).click();
  await expect(search).toBeEmpty();
  await search.fill(searchTerm);
  await status.selectOption("completed");
  await submit.click();
  await next.click();
  await expect(history.getByText("Page 2", { exact: true })).toBeVisible();
  await expect(archivedLink).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? "null"), storageKey),
    )
    .toEqual({
      open: true,
      search: searchTerm,
      status: "completed",
      cursors: [{ id: recent.run.id, created_at: recent.run.created_at }],
    });
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();

  await search.fill("unsubmitted change");
  await status.selectOption("paused");
  await archivedLink.click();
  await expect(page.getByRole("heading", { name: archived.run.study_title! })).toBeVisible();
  await page.getByRole("link", { name: "Research desk", exact: true }).click();
  await expect(search).toHaveValue(searchTerm);
  await expect(status).toHaveValue("completed");
  await expect(history.getByText("Page 2", { exact: true })).toBeVisible();
  await expect(archivedLink).toBeVisible();
  expect(lastQuery?.get("search")).toBe(searchTerm);
  expect(lastQuery?.get("status")).toBe("completed");

  await status.selectOption("paused");
  await submit.click();
  await expect(results.getByRole("link", { name: /Waiting on a decision/ })).toBeVisible();
  await expect(history.getByText("Page 2", { exact: true })).toHaveCount(0);
  await status.selectOption("completed");
  await submit.click();
  await next.click();
  await expect(archivedLink).toBeVisible();

  archivePageMissing = true;
  await page.reload();
  await expect(history.getByText("This page has no saved studies.")).toBeVisible();
  await history.getByRole("button", { name: "Back to first page" }).click();
  await expect(history.getByText("Page 1", { exact: true })).toBeVisible();
  await expect(search).toHaveValue(searchTerm);
  await expect(status).toHaveValue("completed");
  await reset.click();
  await expect(search).toBeFocused();
  await expect(search).toBeEmpty();
  await expect(status).toHaveValue("");
  await expect(reset).toHaveCount(0);

  archivePageMissing = false;
  await next.click();
  await expect(archivedLink).toBeVisible();
  await expect(reset).toBeVisible();
  await reset.click();
  await expect(history.getByText("Page 1", { exact: true })).toBeVisible();
  await expect(archivedLink).toHaveCount(0);
  await expect(reset).toHaveCount(0);
  expect(lastQuery?.get("search")).toBe("");
  expect(lastQuery?.has("status")).toBe(false);
  expect(lastQuery?.has("before_id")).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
