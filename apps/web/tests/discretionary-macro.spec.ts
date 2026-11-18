import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { contentUrl, evidenceUrl } from "../src/lib/evidence";
import type { RunSnapshot } from "../src/lib/workflow";
import sample from "../../../examples/discretionary-macro-brief.json";

test("macro starter asks for judgment and records it in downstream model requests", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const fixture = randomUUID().slice(0, 8);
  const captured = {
    id: randomUUID(),
    title: `Synthetic rates observation ${fixture}`,
    kind: "text",
    rights: "owned",
    text: "Synthetic as-of observation <b>12.00</b> basis points.",
    as_of_date: "2026-11-17",
  };
  const reference = {
    id: randomUUID(),
    title: `Synthetic event reference ${fixture}`,
    kind: "link",
    source_url: "https://example.test/synthetic-event",
    availability: "reference_only",
  };
  for (const source of [captured, reference]) {
    const response = await request.post("/api/evidence", { data: source });
    expect(response.status(), await response.text()).toBe(201);
  }
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
  await page.getByRole("checkbox", { name: `${captured.title} Captured`, exact: true }).check();
  await page.getByRole("checkbox", { name: `${reference.title} Link only`, exact: true }).check();
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
  const runId = new URL(page.url()).searchParams.get("run");
  const savedRunUrl = page.url();
  expect(runId).toBeTruthy();
  const runRoute = `**/api/runs/${runId}`;
  const csv = "series,change\n2-year,12.00";
  const artifactId = `sha256:${createHash("sha256").update(csv).digest("hex")}`;
  await page.route(`**${contentUrl(artifactId)}*`, (route) =>
    route.fulfill({ body: csv, contentType: "text/csv" }),
  );
  await page.route(runRoute, async (route) => {
    const response = await route.fetch();
    const snapshot: RunSnapshot = await response.json();
    const receipt = snapshot.model_attempts!.find((attempt) => attempt.path === "root/test")!;
    receipt.result!.workspace_files = [
      {
        name: "macro-observations.csv",
        artifact_id: artifactId,
        byte_size: Buffer.byteLength(csv),
        media_type: "text/csv",
      },
    ];
    await route.fulfill({ response, json: snapshot });
  });
  const desktopViewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 950 });
  await page.getByRole("button", { name: "Refresh run", exact: true }).click();
  await judgment.getByLabel("Reviewer feedback").fill(view);
  await page.getByText("Files for this review (1)", { exact: true }).click();
  const reviewFiles = page.getByRole("region", { name: "Saved workspace files" });
  await reviewFiles
    .getByRole("button", {
      name: "Preview macro-observations.csv from Run the discriminating test, pass 1",
    })
    .click();
  await expect(reviewFiles.getByRole("cell", { name: "12.00", exact: true })).toBeVisible();
  await expect(judgment.getByLabel("Reviewer feedback")).toHaveValue(view);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.unroute(runRoute);
  if (desktopViewport) await page.setViewportSize(desktopViewport);
  await page.getByRole("button", { name: "Decisions (1)", exact: true }).click();
  const needed = page.getByRole("region", { name: "Decisions needed", exact: true });
  await expect(needed).toContainText("Weigh the thesis and the dissent");
  const recorded = page.getByRole("region", { name: "Recorded decisions", exact: true });
  await expect(recorded).toContainText(question);
  await needed.getByRole("button", { name: "Open review", exact: true }).press("Enter");
  await expect(judgment.getByLabel("Reviewer feedback")).toHaveValue(view);
  await page.getByText("Earlier evidence and analysis", { exact: true }).click();
  await page.getByRole("button", { name: "Run the discriminating test", exact: true }).click();
  await expect(page.getByRole("region", { name: "Selected step" })).toContainText(
    "1 of 10 research passes used",
  );
  const stepDetails = page.getByRole("region", { name: "Selected step" });
  await stepDetails.getByText("Data bindings", { exact: true }).click();
  const boundInputs = stepDetails.getByRole("region", { name: "Connected inputs" });
  const boundOutputs = stepDetails.getByRole("region", { name: "Connected outputs" });
  await expect(
    boundInputs.getByRole("button", { name: "Estimate what markets price · text", exact: true }),
  ).toBeVisible();
  await expect(
    boundInputs.getByRole("button", {
      name: "Choose the question and horizon · feedback",
      exact: true,
    }),
  ).toBeVisible();
  await boundOutputs
    .getByRole("button", { name: "Challenge the transmission story · context", exact: true })
    .click();
  await expect(
    stepDetails.getByRole("heading", { name: "Challenge the transmission story", exact: true }),
  ).toBeVisible();
  await boundInputs
    .getByRole("button", { name: "Run the discriminating test · text", exact: true })
    .click();
  await expect(stepDetails).toContainText("1 of 10 research passes used");
  const latest = page.getByLabel("Latest workflow activity", { exact: true });
  await expect(latest).toContainText("Weigh the thesis and the dissent");
  await expect(latest).toContainText("Waiting for review");
  await page.getByRole("button", { name: "Return to review", exact: true }).click();
  await expect(judgment.getByLabel("Reviewer feedback")).toHaveValue(view);
  await judgment.getByRole("button", { name: "Approve and continue" }).click();
  await expect(editorial).toBeVisible({ timeout: 30000 });

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
  let completeHistory!: () => void;
  const delayedHistory = new Promise<void>((resolve) => {
    completeHistory = resolve;
  });
  const historyRoute = "**/api/runs?agent_id=*";
  await page.route(historyRoute, async (route) => {
    const response = await route.fetch();
    await delayedHistory;
    await route.fulfill({ response });
  });
  const refresh = page.waitForRequest((request) => request.url().includes("/api/runs?agent_id="));
  const decisions = page.getByRole("button", { name: "Decisions", exact: true });
  const marketJudgment = recorded.getByRole("listitem").filter({ hasText: view });
  try {
    await editorial.getByRole("button", { name: "Approve and continue" }).click();
    await refresh;
    await expect(page.getByRole("status", { name: "Run status", exact: true })).toHaveText(
      "Completed",
    );
    await decisions.click();
    await expect(needed).toHaveCount(0);
    await expect(recorded.getByRole("listitem")).toHaveCount(3);
    await marketJudgment.getByText("Steps wired to this feedback (2)", { exact: true }).click();
  } finally {
    completeHistory();
  }
  await expect(page.getByRole("button", { name: "Refresh run", exact: true })).toBeEnabled();
  await expect(decisions).toHaveAttribute("aria-pressed", "true");
  await page.unroute(historyRoute);
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
  await page.setViewportSize({ width: 390, height: 950 });
  await selected.getByText("Inspect saved inputs", { exact: true }).click();
  const inputs = selected.getByRole("region", { name: "Saved model inputs" });
  await expect(inputs.getByRole("heading", { name: "Reviewer feedback" })).toBeVisible();
  await expect(inputs.getByText(view, { exact: true })).toBeVisible();
  await inputs.getByText("Prior result conclusion", { exact: true }).click();
  const scenarioReceipt = await (
    await request.get(contentUrl(scenarioAttempt.input_artifact_id!))
  ).json();
  const scenarioPacket = JSON.parse(scenarioReceipt.input[0].content[0].text);
  await expect(
    inputs.getByText(scenarioPacket.prior_result.conclusion, { exact: true }),
  ).toBeVisible();
  await inputs.getByText("Evidence in the request (2)", { exact: true }).click();
  const sent = inputs.getByRole("listitem").filter({ hasText: captured.title });
  const metadata = inputs.getByRole("listitem").filter({ hasText: reference.title });
  await expect(sent).toContainText("As of 2026-11-17");
  await expect(sent).toContainText("complete UTF-8 text of the captured original");
  await expect(sent.getByRole("link")).toHaveAttribute("href", evidenceUrl(captured.id));
  await sent.getByText("Supplied text", { exact: true }).click();
  await expect(sent.locator("pre")).toHaveText(captured.text);
  await expect(metadata).toContainText("metadata only; content has not been supplied to the model");
  await expect(metadata.getByText("Supplied text")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (desktopViewport) await page.setViewportSize(desktopViewport);
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

  await page.goto(savedRunUrl);
  await page.setViewportSize({ width: 390, height: 950 });
  await page.getByRole("button", { name: "Decisions", exact: true }).click();
  await recorded.getByText("Combine feedback for next run", { exact: true }).click();
  const revise = recorded.getByRole("button", { name: "Open next experiment in Build" });
  const prior = recorded.getByRole("textbox", { name: "Prior research brief", exact: true });
  const next = recorded.getByRole("textbox", { name: "Next research brief", exact: true });
  const includeMandate = recorded.getByRole("checkbox", {
    name: /Choose the question and horizon/,
  });
  const includeJudgment = recorded.getByRole("checkbox", {
    name: /Weigh the thesis and the dissent/,
  });
  await expect(prior).toHaveValue(run.brief);
  await expect(revise).toBeDisabled();
  await includeJudgment.check();
  await includeMandate.check();
  await prior.fill("x".repeat(10000));
  await expect(recorded.getByRole("alert")).toContainText("Shorten the prior brief");
  await expect(revise).toBeDisabled();
  const update = "Recheck the divergence after the next inflation release.";
  await prior.fill(update);
  await includeMandate.uncheck();
  await expect(next).not.toHaveValue(/Choose the question and horizon/);
  await includeMandate.check();
  await page.getByRole("button", { name: "Run context", exact: true }).click();
  await page.getByRole("button", { name: "Decisions", exact: true }).click();
  const shortId = run.id.slice(0, 8);
  const composed = [
    update,
    `Reviewer feedback from Choose the question and horizon (${shortId}):\n${question}`,
    `Reviewer feedback from Weigh the thesis and the dissent (${shortId}):\n${view}`,
  ].join("\n\n");
  await expect(next).toHaveValue(composed);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await revise.click();
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Research brief", exact: true })).toHaveValue(
    composed,
  );
  await expect(
    page.getByRole("checkbox", { name: `${captured.title} Captured`, exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: `${reference.title} Link only`, exact: true }),
  ).toBeChecked();
  const baseline = page.getByRole("link", { name: `Baseline run · ${shortId}`, exact: true });
  await expect(baseline).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Research brief", exact: true })).toHaveValue(
    composed,
  );
  await expect(baseline).toBeVisible();
  await page.getByRole("button", { name: "Clear baseline", exact: true }).click();
  await expect(baseline).toHaveCount(0);
  await expect(page.getByLabel("Research brief", { exact: true })).toBeFocused();
});
