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
  await page.getByRole("textbox", { name: "Research direction" }).fill(note);
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

test("direct a live researcher and send confirmed findings to the report editor", async ({
  page,
}) => {
  const id = crypto.randomUUID();
  const created_at = "2026-11-25T19:02:00Z";
  const attempt = { stage: "custom", model: "synthetic", created_at, status: "completed" };
  const researcherPath = "root/team/lead-2/agent-1";
  const handoffs: { id: string; text: string }[] = [];
  let note: { id: string; text: string; target_path: string; created_at: string } | undefined;
  let reportRequest: { id: string; text: string; created_at: string } | undefined;
  await page.route(`**/api/research-sessions/${id}/directions`, (route) => {
    note = { ...route.request().postDataJSON(), created_at };
    return route.fulfill({ json: note });
  });
  await page.route(`**/api/research-sessions/${id}/write-report`, (route) => {
    const command = route.request().postDataJSON();
    handoffs.push(command);
    if (handoffs.length === 1)
      return route.fulfill({
        status: 503,
        json: { detail: "The handoff could not be confirmed." },
      });
    reportRequest = { ...command, created_at };
    return route.fulfill({ json: reportRequest });
  });
  const attempts = [
    {
      ...attempt,
      id: crypto.randomUUID(),
      path: "root/team/plan",
      result: {
        swarm_plan: {
          leads: [
            { title: "Orders", objective: "Check the order history." },
            { title: "Supply", objective: "Check available inventories." },
          ],
        },
      },
    },
    {
      ...attempt,
      id: crypto.randomUUID(),
      path: "root/team/lead-1/turn-1",
      result: {
        swarm_action: { action: "finish", findings: "Orders increased.", limitations: [] },
      },
    },
    {
      ...attempt,
      id: crypto.randomUUID(),
      path: "root/team/lead-2/turn-1",
      result: {
        swarm_action: {
          action: "delegate",
          rationale: "Check supply timing.",
          assignments: [{ title: "Inventory timing", objective: "Compare the release dates." }],
        },
      },
    },
    { ...attempt, id: crypto.randomUUID(), path: researcherPath, status: "requesting" },
  ];
  await page.route(`**/api/runs/${id}`, (route) =>
    route.fulfill({
      json: {
        id,
        created_at,
        status: "running",
        execution_pending: true,
        workflow_name: "Research session",
        brief: "Inspect the change in orders and supply.",
        events: [],
        artifacts: [],
        evidence_ids: [],
        model_attempts: attempts,
        workflow: {
          nodes: [{ id: "team", config: { type: "research", team: { swarm: { lead_count: 2 } } } }],
        },
        research_manifest: {
          settings: { model: "synthetic", limits: { max_model_calls: 30 } },
          evidence: [],
          tool_config: { session: "brief-led-1", owner_directions_version: "owner-directions-1" },
        },
        can_request_report: !reportRequest,
        owner_report_request: reportRequest,
        owner_directions: note && [note],
      },
    }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?session=${id}`);
  await page.getByRole("link", { name: "Team guidance" }).click();
  await page.getByText("Guide the team", { exact: true }).click();
  await page.getByLabel("Send to", { exact: true }).selectOption(researcherPath);
  await page.getByLabel("Research direction").fill("Check the revised inventory dates.");
  await page.getByRole("button", { name: "Send direction", exact: true }).click();
  await expect(page.getByText("Direction saved.")).toBeVisible();
  expect(note).toMatchObject({
    target_path: researcherPath,
    text: "Check the revised inventory dates.",
  });

  await page.getByText("Write report now", { exact: true }).click();
  await page.getByLabel("Notes for the editor (optional)").fill("Explain the inventory caveat.");
  const sendFindings = page.getByRole("button", { name: "Send findings to editor" });
  await sendFindings.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "The handoff could not be confirmed." }),
  ).toBeVisible();
  await sendFindings.click();
  await expect(page.getByText("Report requested", { exact: true })).toBeVisible();
  expect(handoffs).toEqual([
    expect.objectContaining({ text: "Explain the inventory caveat." }),
    handoffs[0],
  ]);
  await page.reload();
  await expect(page.getByText("Report requested", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
