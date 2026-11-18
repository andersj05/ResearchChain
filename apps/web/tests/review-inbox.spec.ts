import { expect, test } from "./fixtures";
import type { AgentDetail, PendingReviewsPage, RunSnapshot } from "../src/lib/workflow";
import example from "../../../examples/advanced-workflow.json";
import legacy from "../../../examples/research-workflow.json";

test("the mobile inbox opens the exact parallel review across agents and handles stale entries", async ({
  page,
  request,
}) => {
  const analyst = { ...legacy, name: "Inbox rates editor" };
  const workflow = structuredClone(example);
  workflow.name = "Inbox macro analysis";
  workflow.schema_version = "0.3";
  workflow.nodes[1]!.kind = "review";
  workflow.nodes[1]!.instructions = "Does the priced path match your rates view?";
  workflow.nodes[2]!.kind = "review";
  workflow.nodes[2]!.instructions = "Which dissenting scenario deserves more work?";
  const agents = await Promise.all(
    [analyst, workflow].map(async (document) => {
      const response = await request.post("/api/agents", {
        data: { id: crypto.randomUUID(), workflow: document },
      });
      expect(response.status()).toBe(201);
      return (await response.json()) as AgentDetail;
    }),
  );
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
  const item = page.getByRole("listitem").filter({ hasText: "Inbox macro analysis" });
  await expect(item.getByRole("button", { name: "Open review", exact: true })).toHaveCount(2);
  const openQuestion = (question: string) =>
    item.locator(".review-inbox-question").filter({ hasText: question }).getByRole("button", {
      name: "Open review",
      exact: true,
    });
  const dissent = openQuestion("Which dissenting scenario deserves more work?");
  await dissent.click();
  await expect(page.getByLabel("Review challenge", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Review support", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Agent", exact: true })).toHaveValue(
    agents[0]!.agent.id,
  );
  const feedback = page.getByRole("textbox", { name: "Reviewer feedback" });
  await feedback.fill("Keep the liquidity explanation in the scenario set.");
  await page.getByText("Review inbox", { exact: true }).click();
  await openQuestion("Does the priced path match your rates view?").click();
  await expect(page.getByLabel("Review support", { exact: true })).toBeVisible();
  await expect(feedback).toHaveValue("");
  await page.getByText("Review inbox", { exact: true }).click();
  await dissent.click();
  await expect(feedback).toHaveValue("Keep the liquidity explanation in the scenario set.");

  // Freeze one inbox response, then resolve it elsewhere before the owner clicks.
  const live: PendingReviewsPage = await (await request.get("/api/runs/reviews")).json();
  const old = live.items.find((entry) => entry.id === id)!;
  await page.route("**/api/runs/reviews?*", (route) =>
    route.fulfill({ json: { items: [old], has_more: false } }),
  );
  await page.getByText("Review inbox", { exact: true }).click();
  await expect(item.getByRole("button", { name: "Open review", exact: true })).toHaveCount(2);
  expect((await request.post(`${runPath}/cancel`)).status()).toBe(200);
  await page.unroute("**/api/runs/reviews?*");
  await item.getByRole("button", { name: "Open review", exact: true }).first().click();
  await expect(
    page.getByText("That checkpoint changed. Select a current review from the inbox."),
  ).toBeVisible();
  await expect(item).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Cancelled");
  await expect(page.getByRole("button", { name: "Approve and continue" })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("run")).toBe(id);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
