import { expect, test } from "./fixtures";
import sample from "../../../examples/equitycats-research-brief.json";
import { contentUrl } from "../src/lib/evidence";
import type { RunSnapshot } from "../src/lib/workflow";

test("EquityCats starter carries the prior gap forward and turns a saved judgment into a memo", async ({
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
  const matchedCloseSource = "https://example.org/synthetic/matched-close";
  expect(
    attempts.find((attempt) => attempt.path === `${loop}/iteration-2/audit`)?.result,
  ).toMatchObject({
    web_research: {
      sources: [
        { url: "https://example.org/data", cited: true },
        { url: matchedCloseSource, cited: true },
      ],
    },
  });
  const memo = attempts.find((attempt) => attempt.path === memoPath)!;
  const payload = await (await request.get(contentUrl(memo.input_artifact_id!))).json();
  expect(JSON.parse(payload.input[0].content[0].text).human_feedback).toBe(feedback);
  const followup = attempts.find((attempt) => attempt.path === `${loop}/iteration-2/pricing`)!;
  const followupPayload = await (await request.get(contentUrl(followup.input_artifact_id!))).json();
  const followupContext = JSON.parse(followupPayload.input[0].content[0].text).additional_context;
  expect(followupContext).toContain(
    "Which prices were available at a common cutoff for synthetic session 1?",
  );
  expect(followupContext).toContain("different session closes could explain");
  expect(followupContext).not.toContain(matchedCloseSource);
  expect(followupPayload.instructions).toContain("Treat its claim and cited sources as leads");

  await inspector.getByRole("button", { name: "Outputs", exact: true }).click();
  const outputs = inspector.getByRole("region", { name: "Saved step outputs", exact: true });
  await outputs
    .getByRole("searchbox", { name: "Find an output", exact: true })
    .fill("Audit the case and the evidence");
  await outputs
    .getByRole("button", {
      name: /^Compare iterations for Audit the case and the evidence · Iteration 2/,
    })
    .click();
  const comparison = inspector.getByRole("region", { name: "Compare saved iterations" });
  await expect(
    comparison.getByRole("region", { name: "Earlier iteration", exact: true }),
  ).toContainText("Synthetic audit found a timestamp gap.");
  await expect(
    comparison.getByRole("region", { name: "Later iteration", exact: true }),
  ).toContainText(
    "The new comparison matches both instruments at 16:00 Eastern for synthetic session 1.",
  );
  await comparison.getByText("Recorded web sources · 1 shared", { exact: true }).click();
  const laterSources = comparison.getByRole("region", { name: "Later iteration web sources" });
  await expect(
    laterSources.getByRole("link", { name: "Synthetic synchronized-close observations" }),
  ).toHaveAttribute("href", matchedCloseSource);
  await expect(
    comparison.getByRole("region", { name: "Earlier iteration web sources" }),
  ).toContainText("No unique web sources recorded.");
});
