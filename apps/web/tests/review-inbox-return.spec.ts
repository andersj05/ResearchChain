import type { PendingReviewsPage, RunSnapshot } from "../src/lib/workflow";
import example from "../../../examples/advanced-workflow.json";
import { expect, test, type Page } from "./fixtures";

async function olderReviews(page: Page) {
  const workflow = structuredClone(example) as RunSnapshot["workflow"];
  workflow.schema_version = "0.3";
  workflow.nodes[1]!.kind = "review";
  workflow.nodes[2]!.kind = "review";
  const id = crypto.randomUUID();
  const checkpoint = crypto.randomUUID();
  const support = {
    interrupt_id: crypto.randomUUID(),
    node_id: "support",
    question: "Does the priced path match your rates view?",
  };
  const challenge = {
    interrupt_id: crypto.randomUUID(),
    node_id: "challenge",
    question: "Which dissenting scenario deserves more work?",
  };
  const items: PendingReviewsPage["items"] = Array.from({ length: 36 }, (_, index) => ({
    id: index === 33 ? id : crypto.randomUUID(),
    checkpoint_id: index === 33 ? checkpoint : crypto.randomUUID(),
    workflow_name: `Rates review ${index + 1}`,
    brief_excerpt: `Study ${index + 1}: compare the priced path with the meeting calendar.`,
    agent_name: index % 2 ? "Rates analyst" : "Macro editor",
    created_at: new Date(Date.UTC(2026, 9, 14 + index)).toISOString(),
    reviews:
      index === 33
        ? [support, challenge]
        : [
            {
              interrupt_id: crypto.randomUUID(),
              node_id: "support",
              question: `What changes the base case for study ${index + 1}?`,
            },
          ],
  }));
  const selected = items[33]!;
  const run: RunSnapshot = {
    id,
    brief: selected.brief_excerpt,
    workflow_name: selected.workflow_name,
    workflow,
    revision_id: crypto.randomUUID(),
    revision_number: 1,
    compiler_version: "test",
    created_at: selected.created_at,
    status: "paused",
    execution_pending: false,
    checkpoint_id: checkpoint,
    reviews: selected.reviews,
    events: [],
    artifacts: [],
  };
  const offsets: number[] = [];
  await page.route("**/api/runs/reviews?*", (route) => {
    const offset = Number(new URL(route.request().url()).searchParams.get("offset"));
    offsets.push(offset);
    return route.fulfill({
      json: { items: items.slice(offset, offset + 20), has_more: offset + 20 < items.length },
    });
  });
  await page.route(`**/api/runs/${id}`, (route) => route.fulfill({ json: run }));
  let decisions = 0;
  await page.route("**/api/runs/*/resume", (route) => {
    decisions += 1;
    return route.abort();
  });

  const inbox = page.locator("details.review-inbox");
  const choice = (question: string) =>
    inbox
      .locator(".review-inbox-question")
      .filter({ hasText: question })
      .getByRole("button", { name: "Open review", exact: true });
  const openPageTwo = async () => {
    await page.goto("/?view=runs");
    await inbox.getByText("Review inbox", { exact: true }).click();
    await inbox.getByRole("button", { name: "Next page", exact: true }).click();
  };
  return {
    inbox,
    choice,
    openPageTwo,
    challenge,
    nextQuestion: items[34]!.reviews[0]!.question,
    resolveChallenge: () => {
      selected.reviews = [support];
      run.reviews = [support];
    },
    bookmark: `/?view=runs&run=${id}&checkpoint=${checkpoint}&review=${challenge.interrupt_id}`,
    offsets,
    decisions: () => decisions,
  };
}

for (const width of [390, 1440]) {
  test(`the inspector returns to the exact older inbox review at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    const queue = await olderReviews(page);
    await queue.openPageTwo();
    const opener = queue.choice(queue.challenge.question);
    await opener.scrollIntoViewIfNeeded();
    await opener.press("Enter");
    await expect(queue.inbox).not.toHaveAttribute("open", "");
    await expect(page.getByLabel("Review challenge", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Review support", { exact: true })).toHaveCount(0);
    const pane = page.locator(".run-reading-pane");
    await expect(pane).toBeFocused();
    const back = pane.getByRole("button", { name: "Back to review inbox", exact: true });
    await expect(back).toBeInViewport();

    const feedback = page.getByRole("textbox", { name: "Reviewer feedback" });
    await feedback.fill("Keep the liquidity explanation in the scenario set.");
    await pane.focus();
    await page.keyboard.press("Tab");
    await expect(back).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(opener).toBeFocused();
    await expect(opener).toBeInViewport();
    await expect(queue.inbox.getByRole("button", { name: "Previous page" })).toBeEnabled();
    expect(queue.offsets).toEqual([0, 20, 20]);

    await opener.press("Enter");
    await expect(feedback).toHaveValue("Keep the liquidity explanation in the scenario set.");
    await expect(page.getByLabel("Review challenge", { exact: true })).toBeVisible();
    await page.goto(queue.bookmark);
    await expect(page.getByLabel("Review challenge", { exact: true })).toBeVisible();
    await expect(back).toHaveCount(0);
    expect(queue.decisions()).toBe(0);
  });
}

test("a changed second page returns focus to the next pending request", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  const queue = await olderReviews(page);
  await queue.openPageTwo();
  await queue.choice(queue.challenge.question).click();
  await expect(page.getByLabel("Review challenge", { exact: true })).toBeVisible();
  await expect(queue.inbox).not.toHaveAttribute("open", "");
  queue.resolveChallenge();
  await page.getByRole("button", { name: "Back to review inbox", exact: true }).click();
  await expect(queue.choice(queue.challenge.question)).toHaveCount(0);
  const successor = queue.choice(queue.nextQuestion);
  await expect(successor).toBeFocused();
  await expect(successor).toBeInViewport();
  expect(queue.offsets).toEqual([0, 20, 20]);
  expect(queue.decisions()).toBe(0);
});
