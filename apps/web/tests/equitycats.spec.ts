import { expect, test } from "./fixtures";
import sample from "../../../examples/equitycats-research-brief.json";
import { contentUrl } from "../src/lib/evidence";
import type { RunSnapshot } from "../src/lib/workflow";

test("EquityCats starter retests the evidence and turns a saved judgment into a memo", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  const create = page.getByRole("dialog", { name: "Create an agent" });
  await create
    .getByLabel("Starting workflow")
    .selectOption({ label: "EquityCats cross-asset research" });
  await expect(create.getByLabel("Agent name")).toHaveValue("EquityCats cross-asset research");
  await create.getByRole("button", { name: "Create agent", exact: true }).click();
  await expect(create).toBeHidden();
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Start a research run" });
  const brief = setup.getByLabel("Research brief", { exact: true });
  await expect(brief).toHaveValue(sample.join("\n"));
  await brief.fill(
    "Follow an analyst lead. Synthetic EquityCats loop fixture. Compare rates and equities over five sessions.",
  );
  await setup
    .getByRole("combobox", { name: "Research model", exact: true })
    .selectOption("test-model");
  await setup.getByRole("button", { name: "Start run", exact: true }).click();

  const verdict = page.getByLabel("Review owner_verdict", { exact: true });
  await expect(verdict).toBeVisible({ timeout: 40_000 });
  const loop = "root/evidence_loop";
  const inspector = page.getByRole("region", { name: "Run inspector" });
  const selectedStep = page.getByRole("region", { name: "Selected step" });
  await expect(selectedStep).toContainText("Synthetic proposal favors the rival");
  await expect(inspector).toContainText("root › evidence_loop › iteration-2 › owner_verdict");
  await page
    .getByRole("navigation", { name: "Nested graph path" })
    .getByRole("button", { name: "Test the view against the evidence", exact: true })
    .click();
  await selectedStep.getByRole("button", { name: "Iteration 1", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Inspect step" })
    .selectOption(`${loop}/iteration-1/audit`);
  await expect(selectedStep).toContainText("Synthetic audit found a timestamp gap.");
  await page.getByRole("button", { name: "Return to review", exact: true }).click();
  const feedback = "Defend the rival and wait for an independent confirmation.";
  await verdict.getByLabel("Reviewer feedback").fill(feedback);
  await verdict.getByRole("button", { name: "Approve and continue" }).click();
  await expect(page.getByRole("status", { name: "Run status", exact: true })).toHaveText(
    "Completed",
    { timeout: 30_000 },
  );
  const memoPath = `${loop}/iteration-2/memo`;
  await page.getByRole("combobox", { name: "Inspect step" }).selectOption(memoPath);
  await expect(selectedStep).toContainText(`Synthetic memo with reviewer judgment. ${feedback}`);
  const runId = new URL(page.url()).searchParams.get("run");
  const response = await request.get(`/api/runs/${runId}`);
  expect(response.ok()).toBeTruthy();
  const run: RunSnapshot = await response.json();
  const attempts = run.model_attempts!;
  expect(attempts).toHaveLength(10);
  expect(attempts.some((attempt) => attempt.path.includes("iteration-3"))).toBe(false);
  expect(
    attempts.find((attempt) => attempt.path === `${loop}/iteration-2/audit`)?.result,
  ).toMatchObject({
    web_research: { sources: [{ url: "https://example.org/data", cited: true }] },
  });
  const memo = attempts.find((attempt) => attempt.path === memoPath)!;
  const payload = await (await request.get(contentUrl(memo.input_artifact_id!))).json();
  expect(JSON.parse(payload.input[0].content[0].text).human_feedback).toBe(feedback);
});
