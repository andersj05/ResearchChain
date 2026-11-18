import { createHash } from "node:crypto";
import type { components } from "@researchchain/contracts";
import type { RunSnapshot, WorkflowRevision } from "../src/lib/workflow";
import { expect, test } from "./fixtures";

test("configure a research workspace and inspect saved files during the next pass", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New workflow", exact: true }).click();
  await page.getByRole("button", { name: "Add research workspace", exact: true }).click();
  const python = page.getByRole("checkbox", { name: "Python workspace" });
  await expect(python).toBeChecked();
  await page.getByRole("button", { name: "Edit run limits" }).click();
  const seconds = page.getByRole("spinbutton", { name: "Maximum active seconds" });
  await expect(seconds).toBeFocused();
  await expect(seconds).toHaveValue("1800");
  await seconds.fill("1500");
  await python.uncheck();
  await page.getByRole("spinbutton", { name: "Maximum research passes" }).fill("1");
  await python.check();
  await expect(page.getByRole("spinbutton", { name: "Maximum research passes" })).toHaveValue("2");
  const revision = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/revisions") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save revision", exact: true }).click();
  const response = await revision;
  expect(response.ok()).toBeTruthy();
  const saved: WorkflowRevision = await response.json();
  const workflow = saved.workflow;
  expect(workflow.budgets?.max_active_seconds).toBe(1500);

  const runId = crypto.randomUUID();
  const id = workflow.start_node;
  const now = new Date().toISOString();
  const script = "print('Synthetic observations')";
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3VkAAAAASUVORK5CYII=",
    "base64",
  );
  const outputs = [
    { name: "analysis.py", body: Buffer.from(script), media: "text/plain" },
    { name: "chart.png", body: image, media: "image/png" },
  ];
  const files = outputs.map(({ name, body, media }) => ({
    name,
    byte_size: body.length,
    media_type: media,
    artifact_id: createHash("sha256").update(body).digest("hex"),
  }));
  for (const [index, output] of outputs.entries()) {
    await page.route(`**/api/artifacts/${files[index]!.artifact_id}/content*`, (route) =>
      route.fulfill({ body: output.body, contentType: output.media }),
    );
  }
  const attempt: components["schemas"]["ModelAttempt"] = {
    id: crypto.randomUUID(),
    path: `root/${id}`,
    stage: "custom",
    model: "test-model",
    status: "requesting",
    input_bytes: 0,
    output_characters: 0,
    created_at: now,
  };
  const result: components["schemas"]["StoredResearchResult"] = {
    stage: "custom",
    schema_version: "research-result-1",
    conclusion: "Synthetic pass",
    hypotheses: [],
    limitations: [],
    revision_summary: "",
    evidence_requests: [],
    unresolved_questions: [],
  };
  const snapshot: RunSnapshot = {
    id: runId,
    workflow,
    workflow_name: workflow.name,
    revision_id: saved.id,
    revision_number: saved.number,
    created_at: now,
    status: "running",
    brief: "Inspect a synthetic Python action.",
    artifacts: [],
    execution_pending: true,
    events: [],
    checkpoint_id: null,
    compiler_version: "research-0.3.0",
  };
  let finishedPython = false;
  const nextId = crypto.randomUUID();
  await page.route(`**/api/runs/${runId}`, (route) => {
    const activity: components["schemas"]["WorkspaceActivity"] = {
      tool: "run_python",
      summary: "Chart the synthetic observations",
      status: finishedPython ? "completed" : "requested",
      output: finishedPython ? "Synthetic observations" : "",
      files: finishedPython ? files : [files[0]!],
    };
    return route.fulfill({
      json: {
        ...snapshot,
        model_attempts: [
          {
            ...attempt,
            status: finishedPython ? "completed" : "requesting",
            result: { ...result, workspace_activity: activity },
          },
          ...(finishedPython
            ? [{ ...attempt, id: nextId, path: `root/${id}/analyst-pass-2` }]
            : []),
        ],
      },
    });
  });
  await page.goto(`/?run=${runId}`);
  const activity = page.getByRole("region", { name: "Workspace activity" });
  await expect(activity).toContainText("Chart the synthetic observations");
  await expect(
    page.getByRole("button", { name: "Inspect Research workspace", exact: true }),
  ).toContainText("Python requested");
  finishedPython = true;
  await expect(activity.getByRole("status")).toContainText("Pass 2");
  const workspace = page.getByRole("region", { name: "Workspace files" });
  await workspace
    .getByRole("combobox", { name: "Preview workspace file" })
    .selectOption("chart.png");
  await expect(workspace.getByRole("img", { name: "Generated chart, chart.png" })).toBeVisible();
  await workspace.getByRole("combobox").selectOption("analysis.py");
  await expect(workspace.locator("pre")).toHaveText(script);
  await expect(workspace.getByRole("link", { name: "Download analysis.py" })).toHaveAttribute(
    "download",
    "analysis.py",
  );
  await activity.getByText("Execution output", { exact: true }).click();
  await expect(activity.locator("pre")).toHaveText("Synthetic observations");
});
