import { expect, test, type Page } from "./fixtures";

async function openLiveStudy(page: Page, width: number, savedPass = false) {
  const id = crypto.randomUUID();
  const createdAt = "2026-11-25T04:00:00Z";
  const activePath = "root/team/lead-3/agent-19";
  const leads = ["Demand", "Supply", "Credit", "Policy"].map((title) => ({
    title,
    objective: `Review weekly ${title.toLowerCase()} data.`,
  }));
  function completed(path: string, result: object) {
    return {
      id: crypto.randomUUID(),
      path,
      stage: "custom",
      model: "synthetic",
      status: "completed",
      created_at: createdAt,
      finished_at: createdAt,
      input_bytes: 0,
      output_characters: 0,
      result: {
        schema_version: "research-result-1",
        stage: "custom",
        hypotheses: [],
        unresolved_questions: [],
        evidence_requests: [],
        conclusion: "",
        revision_summary: "",
        limitations: [],
        ...result,
      },
    };
  }
  const earlier = completed(activePath, {
    conclusion: "Earlier synthetic credit observations.",
  });
  await page.route(`**/api/runs/${id}`, (route) =>
    route.fulfill({
      json: {
        id,
        brief: "Compare weekly release risk across four synthetic regions.",
        study_title: "Weekly release risk across four regions",
        status: "running",
        created_at: createdAt,
        execution_pending: false,
        events: [],
        artifacts: [],
        evidence_ids: [],
        workflow: {
          nodes: [
            {
              id: "team",
              config: {
                type: "research",
                team: { swarm: { lead_count: 4, researchers_per_lead: 20 } },
              },
            },
          ],
        },
        research_manifest: {
          settings: { model: "synthetic", limits: { max_model_calls: 100 } },
          evidence: [],
          tool_config: { session: "brief-led-1" },
        },
        model_attempts: [
          completed("root/team/plan", { swarm_plan: { leads } }),
          ...leads.map(({ title }, index) =>
            completed(`root/team/lead-${index + 1}/turn-1`, {
              swarm_action: {
                action: "delegate",
                rationale: "Inspect the synthetic weekly releases.",
                assignments: Array.from({ length: 20 }, (_, release) => ({
                  title: `${title} release ${release + 1}`,
                  objective: `Check release ${release + 1} for revisions in the synthetic series.`,
                })),
              },
            }),
          ),
          earlier,
          {
            id: crypto.randomUUID(),
            path: `${activePath}/analyst-pass-2`,
            stage: "custom",
            model: "synthetic",
            status: "requesting",
            created_at: createdAt,
            input_bytes: 1024,
            output_characters: 325,
          },
        ],
      },
    }),
  );
  await page.setViewportSize({ width, height: width === 320 ? 740 : 844 });
  const query = new URLSearchParams({ session: id });
  if (savedPass) {
    query.set("workspace", "lead-3/agent-19");
    query.set("pass", earlier.id);
  }
  await page.goto(`/?${query}`);
  return {
    query: `?${query}`,
    sections: page.getByRole("navigation", { name: "Study sections" }),
    workspace: page.getByRole("region", { name: "Credit release 19 workspace" }),
    roster: page.getByRole("navigation", { name: "Agent workspaces" }),
  };
}

for (const width of [320, 390]) {
  test(`jumps straight to the open workspace and returns to study sections at ${width}px`, async ({
    page,
  }, info) => {
    const savedPass = width === 320;
    const { query, sections, workspace, roster } = await openLiveStudy(page, width, savedPass);
    await expect(roster.getByRole("button", { name: /^Credit release 19/ })).toHaveAttribute(
      "aria-current",
      "true",
    );

    const workspacesLink = sections.getByRole("link", { name: "Workspaces", exact: true });
    await expect(workspacesLink).toHaveAttribute("href", "#research-workspaces");
    await workspacesLink.press("Enter");
    await expect(page.locator("#research-workspaces")).toBeFocused();
    await expect(workspace).not.toBeInViewport();

    const currentLink = sections.getByRole("link", { name: "Current workspace", exact: true });
    await expect(currentLink).toHaveAttribute("href", "#current-research-workspace");
    await currentLink.press("Enter");
    await expect(workspace).toBeFocused();
    await expect(workspace.getByRole("heading", { name: "Credit release 19" })).toBeInViewport();
    await expect(page).toHaveURL(`/${query}#current-research-workspace`);
    if (savedPass) {
      await expect(workspace.getByRole("region", { name: "Pass 1", exact: true })).toContainText(
        "Earlier synthetic credit observations.",
      );
    } else {
      await expect(workspace.getByText("Model request in progress")).toBeInViewport();
    }
    await page.screenshot({ path: info.outputPath("current-workspace.png") });

    const returnLink = workspace.getByRole("link", { name: "Study sections", exact: true });
    await expect(returnLink).toBeInViewport();
    await returnLink.press("Enter");
    await expect(sections).toBeFocused();
    await expect(currentLink).toBeInViewport();
    await expect(page).toHaveURL(`/${query}#study-sections`);
    await sections.getByRole("link", { name: "Session controls", exact: true }).press("Enter");
    await expect(page.locator("#session-controls")).toBeFocused();
    expect(new URL(page.url()).search).toBe(query);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("keeps the desktop workspace roster and detail side by side", async ({ page }) => {
  const { sections, workspace, roster } = await openLiveStudy(page, 1440);
  await expect(sections.getByRole("link", { name: "Current workspace", exact: true })).toHaveCount(
    0,
  );
  await expect(workspace.getByRole("link", { name: "Study sections", exact: true })).toHaveCount(0);
  await sections.getByRole("link", { name: "Workspaces", exact: true }).press("Enter");
  await expect(page.locator("#research-workspaces")).toBeFocused();
  await expect(workspace.getByRole("heading", { name: "Credit release 19" })).toBeInViewport();
  const rosterBox = (await roster.boundingBox())!;
  const workspaceBox = (await workspace.boundingBox())!;
  expect(workspaceBox.x).toBeGreaterThan(rosterBox.x);
  expect(workspaceBox.y).toBe(rosterBox.y);
});
