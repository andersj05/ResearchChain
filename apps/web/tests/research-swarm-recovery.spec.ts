import { expect, test } from "./fixtures";
import type { RunSnapshot } from "../src/lib/workflow";

test("resume a failed swarm from its saved workspace", async ({ page }) => {
  const runId = crypto.randomUUID();
  const commandId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const now = new Date().toISOString();
  let status: RunSnapshot["status"] = "failed";
  const submitted: unknown[] = [];
  await page.route(`**/api/runs/${runId}`, (route) =>
    route.fulfill({
      json: {
        id: runId,
        brief: "Compare two synthetic employment reports.",
        created_at: now,
        execution_pending: status === "queued",
        status,
        stop_reason: status === "failed" ? "OpenAI could not complete the request." : null,
        recovery_command_id: status === "failed" ? commandId : null,
        checkpoint_id: "same-checkpoint",
        events: [],
        artifacts: [],
        evidence_ids: [],
        workflow: {
          nodes: [{ id: "team", config: { type: "research", team: { swarm: {} } } }],
        },
        research_manifest: {
          settings: { model: "gpt-6.2-astra", limits: { max_model_calls: 60 } },
          evidence: [],
          tool_config: { session: "brief-led-1" },
        },
        model_attempts: [
          {
            id: attemptId,
            path: "root/team/plan",
            status: "failed",
            model: "gpt-6.2-astra",
            created_at: now,
            finished_at: now,
            input_bytes: 0,
            output_characters: 0,
            provider_failure: { source: "http", http_status: 503, request_id: "req_synthetic" },
            superseded_at: status === "failed" ? null : now,
          },
        ],
      },
    }),
  );
  await page.route(`**/api/runs/${runId}/recover`, (route) => {
    submitted.push(route.request().postDataJSON());
    if (submitted.length === 1)
      return route.fulfill({ status: 503, json: { detail: "Admission was temporarily busy." } });
    status = "queued";
    return route.fulfill({ status: 202, json: { run_id: runId } });
  });
  await page.goto(`/?session=${runId}&workspace=director&pass=${attemptId}`);
  const runStatus = page.getByRole("status", { name: "Run status" });
  const workspace = page.locator("#current-research-workspace");
  const resume = page.getByRole("button", { name: "Resume research", exact: true });
  await expect(runStatus).toHaveText("Needs attention");
  await expect(workspace).toContainText("HTTP 503 · Request ID req_synthetic");
  await resume.focus();
  await resume.press("Enter");
  await expect(
    page.getByRole("alert").filter({ hasText: "Admission was temporarily busy." }),
  ).toBeVisible();
  await resume.click();
  await expect(runStatus).toHaveText("Queued");
  await expect(resume).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`session=${runId}&workspace=director&pass=${attemptId}`));
  await expect(workspace).toContainText("Earlier attempt on this step");
  expect(submitted).toEqual([{ failed_command_id: commandId }, { failed_command_id: commandId }]);
});
