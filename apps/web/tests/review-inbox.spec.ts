import { expect, test } from "./fixtures";
import type { AgentDetail, PendingReviewsPage, RunSnapshot } from "../src/lib/workflow";
import example from "../../../examples/advanced-workflow.json";
import legacy from "../../../examples/research-workflow.json";

test("the mobile inbox opens the exact parallel review across agents and handles stale entries", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const supportQuestion = "Does the priced path match your rates view?";
  const dissentQuestion = "Which dissenting scenario deserves more work?";
  const analyst = { ...legacy, name: "Inbox rates editor" };
  const workflow = structuredClone(example);
  workflow.name = "Inbox macro analysis";
  workflow.schema_version = "0.3";
  workflow.nodes[1]!.kind = "review";
  workflow.nodes[1]!.instructions = supportQuestion;
  workflow.nodes[2]!.kind = "review";
  workflow.nodes[2]!.instructions = dissentQuestion;
  const agents = await Promise.all(
    [analyst, workflow].map(async (document) => {
      const response = await request.post("/api/agents", {
        data: { id: crypto.randomUUID(), workflow: document },
      });
      expect(response.status()).toBe(201);
      return (await response.json()) as AgentDetail;
    }),
  );
  const otherRun = crypto.randomUUID();
  const otherAdmitted = await request.post("/api/runs", {
    data: {
      id: otherRun,
      agent_id: agents[0]!.agent.id,
      revision_id: agents[0]!.revision.id,
      brief: "Synthetic comparison run",
    },
  });
  expect(otherAdmitted.status()).toBe(202);
  const id = crypto.randomUUID();
  const runPath = `/api/runs/${id}`;
  const admitted = await request.post("/api/runs", {
    data: {
      id,
      agent_id: agents[1]!.agent.id,
      revision_id: agents[1]!.revision.id,
      brief: "Synthetic rates disagreement",
    },
  });
  expect(admitted.status()).toBe(202);
  await expect
    .poll(async () => ((await (await request.get(runPath)).json()) as RunSnapshot).status)
    .toBe("paused");
  await page.setViewportSize({ width: 390, height: 950 });
  await page.goto(`/?agent=${agents[0]!.agent.id}&view=runs`);
  await page.getByText("Review inbox", { exact: true }).click();
  const inbox = page.locator("details.review-inbox");
  const item = inbox.getByRole("listitem").filter({ hasText: "Inbox macro analysis" });
  await expect(item.getByRole("button", { name: "Open review", exact: true })).toHaveCount(2);
  await expect(item.getByText("Synthetic rates disagreement", { exact: true })).toBeVisible();
  await expect(
    item.locator(".review-inbox-question").filter({ hasText: dissentQuestion }).getByRole("button"),
  ).toHaveAccessibleDescription(`${dissentQuestion} Synthetic rates disagreement`);
  const scope = page.getByRole("combobox", { name: "Show reviews for" });
  await expect(scope).toHaveValue("all");
  await scope.selectOption("agent");
  const currentAgentReview = inbox.getByRole("listitem").filter({ hasText: "Inbox rates editor" });
  await expect(currentAgentReview.getByRole("button", { name: "Open review" })).toHaveCount(1);
  await expect(
    currentAgentReview.getByText("Synthetic comparison run", { exact: true }),
  ).toBeVisible();
  await expect(item).toHaveCount(0);
  await scope.selectOption("all");
  await expect(item.getByRole("button", { name: "Open review", exact: true })).toHaveCount(2);
  const scopedPage: PendingReviewsPage = await (
    await request.get(`/api/runs/reviews?limit=1&agent_id=${agents[1]!.agent.id}`)
  ).json();
  expect(scopedPage.items.map((entry) => entry.id)).toEqual([id]);
  expect(scopedPage.has_more).toBe(false);
  const openQuestion = (question: string) =>
    item.locator(".review-inbox-question").filter({ hasText: question }).getByRole("button", {
      name: "Open review",
      exact: true,
    });
  const chooseQuestion = async (question: string) => {
    await openQuestion(question).click();
    await expect(inbox).not.toHaveAttribute("open", "");
  };
  await chooseQuestion(dissentQuestion);
  await expect(page.getByLabel("Review challenge", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Review support", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Agent", exact: true })).toHaveValue(
    agents[0]!.agent.id,
  );
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy review link", exact: true }).click();
  await expect(page.getByText("Review link copied.", { exact: true })).toBeVisible();
  const reviewLink = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  const originalCheckpoint = scopedPage.items[0]!;
  expect(reviewLink.searchParams.get("run")).toBe(id);
  expect(reviewLink.searchParams.get("checkpoint")).toBe(originalCheckpoint.checkpoint_id);
  expect(reviewLink.searchParams.get("review")).toBe(
    originalCheckpoint.reviews.find((review) => review.question === dissentQuestion)!.interrupt_id,
  );
  const reviewTab = await page.context().newPage();
  await reviewTab.setViewportSize({ width: 390, height: 950 });
  await reviewTab.goto(reviewLink.href);
  await expect(reviewTab.getByLabel("Review challenge", { exact: true })).toBeVisible();
  await expect(reviewTab.getByLabel("Review support", { exact: true })).toHaveCount(0);
  const feedback = page.getByRole("textbox", { name: "Reviewer feedback" });
  await feedback.fill("Keep the liquidity explanation in the scenario set.");
  await page.getByText("Review inbox", { exact: true }).click();
  await chooseQuestion(supportQuestion);
  await expect(page.getByLabel("Review support", { exact: true })).toBeVisible();
  await expect(feedback).toHaveValue("");
  await feedback.fill("Compare the priced path against the meeting calendar.");
  let draftKey: string | undefined;
  await expect
    .poll(async () => {
      draftKey = await page.evaluate(
        (run) => Object.keys(sessionStorage).find((key) => key.endsWith(`.review-drafts.${run}`)),
        id,
      );
      return draftKey;
    })
    .toBeTruthy();
  const history = page.getByRole("complementary", { name: "Recent runs" });
  await history.getByRole("button", { name: "Recent runs", exact: true }).click();
  await history.getByRole("button", { name: /Inbox rates editor/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("run")).toBe(otherRun);
  await page.getByText("Review inbox", { exact: true }).click();
  await chooseQuestion(dissentQuestion);
  await expect(feedback).toHaveValue("Keep the liquidity explanation in the scenario set.");
  await page.reload();
  await page.getByText("Review inbox", { exact: true }).click();
  await chooseQuestion(supportQuestion);
  await expect(feedback).toHaveValue("Compare the priced path against the meeting calendar.");
  await page.getByText("Review inbox", { exact: true }).click();
  await chooseQuestion(dissentQuestion);
  await expect(feedback).toHaveValue("Keep the liquidity explanation in the scenario set.");

  await page.getByText("Review inbox", { exact: true }).click();
  await chooseQuestion(supportQuestion);
  await expect(page.getByLabel("Review support", { exact: true })).toBeVisible();
  await expect(feedback).toHaveValue("Compare the priced path against the meeting calendar.");
  await page.getByRole("button", { name: "Copy review link", exact: true }).click();
  await expect(page.getByText("Review link copied.", { exact: true })).toBeVisible();
  const supportLink = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  await page.getByRole("button", { name: "Approve and continue", exact: true }).click();
  await expect(page.getByLabel("Review challenge", { exact: true })).toBeVisible();
  await expect(feedback).toHaveValue("Keep the liquidity explanation in the scenario set.");
  await expect
    .poll(async () => {
      const stored = await page.evaluate((key) => sessionStorage.getItem(key), draftKey!);
      return Object.values(JSON.parse(stored ?? "{}"));
    })
    .toEqual(["Keep the liquidity explanation in the scenario set."]);

  // Freeze one inbox response, then resolve it elsewhere before the owner clicks.
  const live: PendingReviewsPage = await (await request.get("/api/runs/reviews")).json();
  const old = live.items.find((entry) => entry.id === id)!;
  expect(old.reviews.map((review) => review.interrupt_id)).not.toContain(
    supportLink.searchParams.get("review"),
  );
  await reviewTab.goto(supportLink.href);
  await expect(reviewTab.getByText("This review link is out of date.")).toBeVisible();
  await expect(reviewTab.getByRole("button", { name: "Approve and continue" })).toHaveCount(0);
  await expect(reviewTab.getByRole("region", { name: "Recorded decisions" })).toContainText(
    "Compare the priced path against the meeting calendar.",
  );
  const wrongCheckpoint = new URL(reviewLink);
  wrongCheckpoint.searchParams.set("checkpoint", crypto.randomUUID());
  await reviewTab.goto(wrongCheckpoint.href);
  await expect(reviewTab.getByText("This review link is out of date.")).toBeVisible();
  await reviewTab
    .getByRole("region", { name: "Decisions needed" })
    .getByRole("button", { name: "Open review" })
    .click();
  await expect(reviewTab.getByLabel("Review challenge", { exact: true })).toBeVisible();
  expect(new URL(reviewTab.url()).searchParams.has("checkpoint")).toBe(false);
  await reviewTab.close();
  await page.route("**/api/runs/reviews?*", (route) =>
    route.fulfill({ json: { items: [old], has_more: false } }),
  );
  await page.getByText("Review inbox", { exact: true }).click();
  await expect(item.getByRole("button", { name: "Open review", exact: true })).toHaveCount(1);
  expect((await request.post(`${runPath}/cancel`)).status()).toBe(200);
  await page.unroute("**/api/runs/reviews?*");
  await item.getByRole("button", { name: "Open review", exact: true }).first().click();
  await expect(
    page.getByText("That checkpoint changed. Select a current review from the inbox."),
  ).toBeVisible();
  await expect(item).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Cancelled");
  await expect
    .poll(() => page.evaluate((key) => sessionStorage.getItem(key), draftKey!))
    .toBeNull();
  expect((await request.post(`/api/runs/${otherRun}/cancel`)).status()).toBe(200);
  await expect(page.getByRole("button", { name: "Approve and continue" })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("run")).toBe(id);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
