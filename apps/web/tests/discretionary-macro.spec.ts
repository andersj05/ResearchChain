import { expect, test } from "./fixtures";
import { contentUrl } from "../src/lib/evidence";
import type { RunSnapshot } from "../src/lib/workflow";
import sample from "../../../examples/discretionary-macro-brief.json";

test("macro starter asks for judgment and records it in downstream model requests", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create an agent" });
  await dialog.getByLabel("Starting workflow").selectOption("macro");
  await expect(dialog.getByLabel("Agent name")).toHaveValue("Discretionary macro research");
  await dialog.getByRole("button", { name: "Create agent", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(
    "Find the cross-asset tension",
  );
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Research brief", exact: true })).toHaveValue(
    sample.join("\n"),
  );
  await page
    .getByRole("combobox", { name: "Research model", exact: true })
    .selectOption("test-model");
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  const mandate = page.getByLabel("Review mandate", { exact: true });
  const judgment = page.getByLabel("Review judgment", { exact: true });
  const editorial = page.getByLabel("Review editorial", { exact: true });
  const question = "Compare only the five sessions after the synthetic event.";
  const view = "Prefer the rival explanation until the curve confirms it.";
  await expect(mandate).toContainText("Feedback goes to Estimate what markets price", {
    timeout: 30000,
  });
  await mandate.getByLabel("Reviewer feedback").fill(question);
  await mandate.getByRole("button", { name: "Approve and continue" }).click();
  await expect(judgment).toContainText("Feedback goes to Build catalyst and risk scenarios", {
    timeout: 30000,
  });
  await page.getByRole("button", { name: "Decisions (1)", exact: true }).click();
  const needed = page.getByRole("region", { name: "Decisions needed", exact: true });
  await expect(needed).toContainText("Weigh the thesis and the dissent");
  const recorded = page.getByRole("region", { name: "Recorded decisions", exact: true });
  await expect(recorded).toContainText(question);
  await needed.getByRole("button", { name: "Open review", exact: true }).press("Enter");
  await judgment.getByLabel("Reviewer feedback").fill(view);
  await page.getByText("Earlier evidence and analysis", { exact: true }).click();
  await page.getByRole("button", { name: "Run the discriminating test", exact: true }).click();
  await expect(page.getByRole("region", { name: "Selected step" })).toContainText(
    "1 of 10 research passes used",
  );
  const latest = page.getByLabel("Latest workflow activity", { exact: true });
  await expect(latest).toContainText("Weigh the thesis and the dissent");
  await expect(latest).toContainText("Waiting for review");
  await page.getByRole("button", { name: "Return to review", exact: true }).click();
  await expect(judgment.getByLabel("Reviewer feedback")).toHaveValue(view);
  await judgment.getByRole("button", { name: "Approve and continue" }).click();
  await expect(editorial).toBeVisible({ timeout: 30000 });

  const runId = new URL(page.url()).searchParams.get("run");
  const run: RunSnapshot = await (await request.get(`/api/runs/${runId}`)).json();
  const checks = [
    ["root/pricing", question],
    ["root/test", question],
    ["root/challenge", question],
    ["root/scenarios", view],
    ["root/memo", view],
  ];
  for (const [path, expected] of checks) {
    const attempt = run.model_attempts?.find((item) => item.path === path);
    expect(attempt?.status).toBe("completed");
    const receipt = await request.get(contentUrl(attempt!.input_artifact_id!));
    expect(receipt.ok()).toBeTruthy();
    const payload = await receipt.json();
    const packet = JSON.parse(payload.input[0].content[0].text);
    expect(packet.human_feedback).toBe(expected);
    expect(packet.prior_result.conclusion).toBeTruthy();
  }
  await editorial.getByRole("button", { name: "Approve and continue" }).click();
  await expect(page.getByRole("status", { name: "Run status", exact: true })).toHaveText(
    "Completed",
  );
  await page.getByRole("button", { name: "Decisions", exact: true }).click();
  await expect(needed).toHaveCount(0);
  await expect(recorded.getByRole("listitem")).toHaveCount(3);
  const marketJudgment = recorded.getByRole("listitem").filter({ hasText: view });
  await marketJudgment.getByText("Steps wired to this feedback (2)", { exact: true }).click();
  const savedRequest = marketJudgment.getByRole("link", {
    name: "Saved request for Build catalyst and risk scenarios",
  });
  const scenarioAttempt = run.model_attempts!.find((attempt) => attempt.path === "root/scenarios")!;
  await expect(savedRequest).toHaveAttribute(
    "href",
    contentUrl(scenarioAttempt.input_artifact_id!),
  );
  await expect(marketJudgment.getByRole("link", { name: /^Saved request for/ })).toHaveCount(2);
  await marketJudgment.getByRole("button", { name: "Build catalyst and risk scenarios" }).click();
  const selected = page.getByRole("region", { name: "Selected step" });
  await expect(
    selected.getByRole("heading", { name: "Build catalyst and risk scenarios" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Decisions", exact: true }).click();
  await recorded
    .getByRole("listitem")
    .filter({ hasText: view })
    .getByRole("button", { name: "Iterate with this feedback", exact: true })
    .click();
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Research brief", exact: true })).toHaveValue(
    `${run.brief}\n\nReviewer feedback from Weigh the thesis and the dissent (${run.id.slice(0, 8)}):\n${view}`,
  );
});
