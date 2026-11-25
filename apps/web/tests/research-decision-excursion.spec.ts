import type { BrowserContext } from "@playwright/test";
import type { PendingReviewsPage, RunSnapshot } from "../src/lib/workflow";
import { expect, test } from "./fixtures";

type Review = NonNullable<RunSnapshot["review"]>;
type Study = PendingReviewsPage["items"][number];
const decisionsUrl = "/?view=research&inbox=1";

function consultation(title: string, index: number): Review {
  const path = `root/team/lead-${index}/turn-1`;
  const question = `Which synthetic series should guide the ${title.toLowerCase()} check?`;
  return {
    node_id: "team",
    path,
    interrupt_id: crypto.randomUUID(),
    question,
    perspective: {
      lead_title: title,
      action_path: path,
      question,
      thesis: "The release timing could change the conclusion.",
      options: [],
      worker_paths: [],
    },
  };
}

function queuedStudy(title: string, reviews: Review[]): Study {
  return {
    id: crypto.randomUUID(),
    agent_name: null,
    study_title: title,
    brief_excerpt: title,
    workflow_name: "Research session",
    created_at: "2026-11-24T18:00:00Z",
    checkpoint_id: crypto.randomUUID(),
    reviews,
  };
}

async function serveStudy(context: BrowserContext, study: Study) {
  await context.route(`**/api/runs/${study.id}`, (route) =>
    route.fulfill({
      json: {
        ...study,
        brief: study.study_title,
        status: "paused",
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
}

test("visit an exact decision and return to the staged study in the same tab", async ({
  page,
  context,
}) => {
  const older = queuedStudy("Older synthetic releases", [consultation("Rates", 1)]);
  const later = queuedStudy("Later synthetic releases", [
    consultation("Demand", 1),
    consultation("Credit", 2),
  ]);
  for (const study of [older, later]) await serveStudy(context, study);
  const preceding = Array.from({ length: 8 }, (_, i) => ({
    ...older,
    id: crypto.randomUUID(),
    study_title: `Earlier open study ${i + 1}`,
  }));
  await page.route("**/api/runs/reviews?*", (route) => {
    const secondPage = new URL(route.request().url()).searchParams.get("offset") === "20";
    return route.fulfill({
      json: { items: secondPage ? [...preceding, later] : [older], has_more: !secondPage },
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const documentToken = crypto.randomUUID();
  await page.evaluate((id) => Reflect.set(window, "decisionExcursionToken", id), documentToken);
  await page.getByLabel("Usage rights").selectOption("owned");
  await page.getByLabel("Source files").setInputFiles({
    name: "staged-release.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Staged synthetic source for a separate study."),
  });
  const files = page.getByRole("list", { name: "Files to pin" });
  const title = files.getByLabel("Packet title for staged-release.txt");
  await title.fill("Staged release note");
  await files.locator("summary").click();
  const author = files.getByLabel("Author / speaker");
  await author.fill("Synthetic file author");

  const heading = page.getByRole("heading", { name: "Study decisions", exact: true });
  const launcherTitle = page.getByRole("heading", { name: "New study", exact: true });
  const decisions = page.getByRole("link", { name: "Decisions", exact: true });
  await decisions.press("Enter");
  await expect(heading).toBeFocused();
  await expect(files).toBeHidden();
  await page.getByRole("button", { name: "Next page" }).click();
  const exact = page.getByRole("link", { name: "Answer Credit" });
  const target = `/?session=${later.id}#consultation-${later.reviews[1]!.interrupt_id}`;
  await expect(exact).toHaveAttribute("href", target);
  await exact.scrollIntoViewIfNeeded();
  const originalTop = (await exact.boundingBox())!.y;
  await exact.press("Enter");
  const credit = page.getByRole("region", { name: "Credit requests your perspective" });
  await expect(page).toHaveURL(target);
  await expect(credit).toBeFocused();
  await credit.getByLabel("Your perspective").fill("Compare both synthetic credit releases.");

  await page.goBack();
  await expect(page).toHaveURL(decisionsUrl);
  await expect(exact).toBeFocused();
  expect(Math.abs((await exact.boundingBox())!.y - originalTop)).toBeLessThan(4);
  await page.goBack();
  await expect(launcherTitle).toBeFocused();
  await expect(title).toHaveValue("Staged release note");
  await expect(author).toHaveValue("Synthetic file author");
  await page.goForward();
  await expect(heading).toBeFocused();
  await expect(exact).toBeVisible();
  await page.goForward();
  await expect(credit).toBeFocused();
  await expect(credit.getByLabel("Your perspective")).toHaveValue(
    "Compare both synthetic credit releases.",
  );

  await decisions.press("Enter");
  await expect(heading).toBeFocused();
  await expect(exact).toBeVisible();
  const opened = context.waitForEvent("page");
  await exact.click({ modifiers: ["ControlOrMeta"] });
  const bookmark = await opened;
  try {
    await bookmark.bringToFront();
    await expect(bookmark).toHaveURL(target);
    await expect(
      bookmark.getByRole("region", { name: "Credit requests your perspective" }),
    ).toBeFocused();
    await expect(bookmark.getByRole("list", { name: "Files to pin" })).toHaveCount(0);
  } finally {
    await bookmark.close();
  }
  await expect(page).toHaveURL(decisionsUrl);
  await page.getByRole("link", { name: "Return to study setup" }).press("Enter");
  await expect(launcherTitle).toBeFocused();

  const summary = page.getByRole("complementary", { name: "Pending study decisions" });
  await summary.getByRole("link", { name: "Older synthetic releases" }).press("Enter");
  await expect(page.getByRole("region", { name: "Rates requests your perspective" })).toBeFocused();
  await page.goBack();
  await expect(launcherTitle).toBeFocused();
  await expect(title).toHaveValue("Staged release note");
  await expect(author).toHaveValue("Synthetic file author");
  expect(await page.evaluate(() => Reflect.get(window, "decisionExcursionToken"))).toBe(
    documentToken,
  );
  await page.getByRole("button", { name: "Pin 1 file", exact: true }).click();
  await expect(page.getByRole("list", { name: "Pinned material" })).toContainText(
    "Staged release note",
  );
});

test("return to the nearest open decision when the last page has emptied", async ({
  page,
  context,
}) => {
  const next = queuedStudy("Still open synthetic study", [consultation("Rates", 1)]);
  const former = queuedStudy("Synthetic study now handled in another tab", [
    consultation("Credit", 1),
  ]);
  await serveStudy(context, former);
  let anotherTabAnswered = false;
  await page.route("**/api/runs/reviews?*", (route) => {
    const secondPage = new URL(route.request().url()).searchParams.get("offset") === "20";
    return route.fulfill({
      json: {
        items: secondPage ? (anotherTabAnswered ? [] : [former]) : [next],
        has_more: !secondPage && !anotherTabAnswered,
      },
    });
  });

  await page.goto(decisionsUrl);
  await page.getByRole("button", { name: "Next page" }).click();
  await page.getByRole("link", { name: "Answer Credit" }).press("Enter");
  await expect(
    page.getByRole("region", { name: "Credit requests your perspective" }),
  ).toBeFocused();
  anotherTabAnswered = true;
  await page.getByRole("link", { name: "Decisions", exact: true }).press("Enter");
  await expect(page).toHaveURL(decisionsUrl);
  await expect(page.getByRole("link", { name: "Answer Rates" })).toBeFocused();
  await expect(page.getByRole("link", { name: "Answer Credit" })).toHaveCount(0);
});
