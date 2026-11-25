import { expect, test } from "./fixtures";

test("retain an unsent direction when the study reaches the editor", async ({ page, context }) => {
  const id = crypto.randomUUID();
  const note = "Check both synthetic release dates.\nKeep the alternative explanation visible.";
  const now = "2026-11-24T18:00:00Z";
  let editing = false;
  let completed = false;
  let sends = 0;
  const editorId = crypto.randomUUID();
  await page.route(`**/api/research-sessions/${id}/directions`, (route) => {
    sends += 1;
    return route.fulfill({ status: 409, json: { detail: "Synthetic editor is already running." } });
  });
  await page.route(`**/api/runs/${id}`, (route) =>
    route.fulfill({
      json: {
        id,
        brief: "Review the synthetic release order.",
        workflow_name: "Research session",
        created_at: now,
        status: completed ? "completed" : "running",
        execution_pending: false,
        events: [],
        artifacts: [],
        evidence_ids: [],
        workflow: { nodes: [] },
        research_manifest: {
          settings: { model: "synthetic", limits: { max_model_calls: 30 } },
          evidence: [],
          tool_config: { session: "brief-led-1", owner_directions_version: "owner-directions-1" },
        },
        model_attempts: editing
          ? [
              {
                id: editorId,
                path: "root/report",
                stage: "custom",
                model: "synthetic",
                status: completed ? "completed" : "requesting",
                created_at: now,
              },
            ]
          : [],
      },
    }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/?session=${id}`);
  await page.getByText("Guide the team", { exact: true }).click();
  await page.getByRole("textbox", { name: "Direction for upcoming passes" }).fill(note);
  editing = true;

  const unsent = page.getByRole("textbox", { name: "Unsent direction" });
  await expect(unsent).toHaveValue(note);
  await expect(unsent).not.toBeEditable();
  await expect(page.getByRole("button", { name: "Send direction" })).toHaveCount(0);
  await page.getByRole("button", { name: "Copy unsent direction" }).click();
  await expect(page.getByText("Unsent direction copied.")).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.replaceAll("\r\n", "\n")).toBe(note);

  completed = true;
  await page.reload();
  await page.getByText("Team directions", { exact: true }).click();
  await expect(unsent).toHaveValue(note);
  expect(sends).toBe(0);
});
