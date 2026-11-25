import type { RunSnapshot } from "../src/lib/workflow";
import { expect, test } from "./fixtures";

type Attempt = NonNullable<RunSnapshot["model_attempts"]>[number];
type Result = NonNullable<Attempt["result"]>;

function receipt(path: string, day: number, result: Partial<Result>): Attempt {
  const time = new Date(Date.UTC(2026, 10, day)).toISOString();
  return {
    id: crypto.randomUUID(),
    path,
    stage: "custom",
    model: "synthetic",
    status: "completed",
    created_at: time,
    finished_at: time,
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

test("reopens an exact historical pass with its own findings, files, and sources", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => copied,
        writeText: async (text: string) => {
          copied = text;
        },
      },
    });
  });
  const runId = crypto.randomUUID();
  const plan = receipt("root/team/plan", 19, {
    team_plan: {
      assignments: [{ title: "Release checks", objective: "Compare the data vintages." }],
    },
  });
  const attempts = [plan];
  for (const [index, vintage] of ["Original", "Revised"].entries()) {
    const artifactId = crypto.randomUUID();
    const csv = `Vintage,Value\n${vintage},${index + 1}\n`;
    const source = `https://example.test/${vintage.toLowerCase()}-release`;
    const attempt = receipt(
      index ? "root/team/agent-1/analyst-pass-2" : "root/team/agent-1",
      20 + index,
      {
        conclusion: `${vintage} conclusion. [${vintage} release](${source})`,
        workspace_files: [
          {
            name: "observations.csv",
            media_type: "text/csv",
            artifact_id: artifactId,
            byte_size: csv.length,
          },
        ],
        web_research: {
          version: "web-research-1",
          observed_at: plan.created_at,
          truncated: false,
          actions: [],
          sources: [{ title: `${vintage} release`, url: source, cited: true }],
        },
      },
    );
    attempt.input_artifact_id = crypto.randomUUID();
    attempts.push(attempt);
    await page.route(`**/api/artifacts/${artifactId}/content`, (route) =>
      route.fulfill({ body: csv, contentType: "text/csv" }),
    );
  }
  const [, earlier, later] = attempts;
  await page.route(`**/api/runs/${runId}`, (route) =>
    route.fulfill({
      json: {
        id: runId,
        brief: "Audit the original and revised observations.",
        created_at: plan.created_at,
        status: "completed",
        execution_pending: false,
        events: [],
        artifacts: [],
        evidence_ids: [],
        workflow: { nodes: [] },
        research_manifest: {
          settings: { model: "synthetic", limits: { max_model_calls: 30 } },
          evidence: [],
          tool_config: { session: "brief-led-1" },
        },
        model_attempts: attempts,
      },
    }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?session=${runId}&workspace=agent-1`);
  await expect(page.getByText("Active time unreported", { exact: true })).toBeVisible();
  const workspace = page.getByRole("region", { name: "Release checks workspace" });
  await expect(workspace).toContainText("Revised conclusion.");
  await expect(workspace.getByRole("cell", { name: "Revised" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Study sections" })
    .getByRole("link", { name: "Activity log" })
    .click();
  await page
    .locator("#research-activity")
    .getByRole("button", { name: /Release checks.*Pass 1/ })
    .click();
  const savedPass = workspace.getByRole("region", { name: "Pass 1", exact: true });
  await expect(workspace).toBeFocused();
  await expect(savedPass).toContainText("Original conclusion.");
  await expect(workspace).not.toContainText("Revised conclusion.");
  const files = savedPass.getByRole("region", { name: "Files in this pass" });
  await expect(files.getByRole("cell", { name: "Original" })).toBeVisible();
  await expect(files.getByRole("cell", { name: "Revised" })).toHaveCount(0);
  await expect(savedPass.getByRole("link", { name: "Original release" })).toBeVisible();
  await expect(savedPass.getByRole("link", { name: "Revised release" })).toHaveCount(0);
  await expect(savedPass.getByRole("link", { name: "Saved request" })).toHaveAttribute(
    "href",
    new RegExp(earlier!.input_artifact_id!),
  );
  await expect(savedPass.getByRole("link", { name: "Inspect pass in Runs" })).toHaveAttribute(
    "href",
    `/?view=runs&run=${runId}&attempt=${earlier!.id}`,
  );

  const bookmark = page.url();
  expect(new URL(bookmark).searchParams.get("pass")).toBe(earlier!.id);
  const readClipboard = () => page.evaluate(() => navigator.clipboard.readText());
  expect(await readClipboard()).toBe("");
  await page.getByRole("button", { name: "Copy study link", exact: true }).click();
  await expect(page.getByText("Study link copied.", { exact: true })).toBeVisible();
  expect(await readClipboard()).toBe(new URL(`/?session=${runId}`, bookmark).href);
  await expect(page).toHaveURL(bookmark);
  await expect(workspace.getByRole("link", { name: "Back to activity" })).toBeVisible();

  const copyPass = savedPass.getByRole("button", { name: "Copy pass link", exact: true });
  const inspectorUrl = new URL(`/?view=runs&run=${runId}&attempt=${earlier!.id}`, bookmark).href;
  await copyPass.click();
  await expect(savedPass.getByText("Pass link copied.", { exact: true })).toBeVisible();
  expect(await readClipboard()).toBe(inspectorUrl);
  await expect(page).toHaveURL(bookmark);

  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new DOMException("Clipboard unavailable", "NotAllowedError");
    };
  });
  await copyPass.click();
  await expect(savedPass.getByText("Could not copy the link. Copy it below.")).toBeVisible();
  const manual = savedPass.getByRole("textbox", { name: "Copy pass link manually" });
  await expect(manual).toHaveValue(inspectorUrl);
  await expect(manual).toHaveAttribute("readonly", "");
  await expect(page).toHaveURL(bookmark);

  await page.reload();
  await expect(page).toHaveURL(bookmark);
  await expect(workspace.getByRole("link", { name: "Back to activity" })).toHaveCount(0);
  await expect(savedPass).toContainText("Original conclusion.");
  await expect(files.getByRole("cell", { name: "Original" })).toBeVisible();
  await expect(workspace).not.toContainText("Revised conclusion.");
  await savedPass.getByLabel("Inspect model pass").selectOption(later!.id);
  await expect(workspace.getByRole("region", { name: "Pass 2", exact: true })).toContainText(
    "Revised conclusion.",
  );
  await workspace.getByRole("button", { name: "Back to latest workspace" }).click();
  await expect(workspace).toBeFocused();
  await expect(workspace.getByRole("cell", { name: "Revised" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("pass")).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("opens exact standalone editor findings from a completed legacy study", async ({ page }) => {
  const runId = crypto.randomUUID();
  const plan = receipt("root/team/plan", 19, {
    team_plan: {
      assignments: [{ title: "Inventory checks", objective: "Read the earlier releases." }],
    },
  });
  const researcher = receipt("root/team/agent-1", 20, {
    conclusion: "A saved finding from the inventory researcher.",
  });
  const partial = receipt("root/report", 21, {
    conclusion: "An intermediate editor finding about the release.",
    next_lead: "Check the second release before finishing.",
  });
  const conclusion = "The final editor verified the two releases used the same dates.";
  const editor = {
    ...receipt("root/report/analyst-pass-2", 22, { conclusion }),
    input_artifact_id: crypto.randomUUID(),
    response_artifact_id: crypto.randomUUID(),
  };
  let status: RunSnapshot["status"] = "completed";
  let attempts = [plan, researcher, partial, editor];
  await page.route(`**/api/runs/${runId}`, (route) =>
    route.fulfill({
      json: {
        id: runId,
        brief: "Check the legacy inventory study.",
        created_at: plan.created_at,
        status,
        execution_pending: false,
        events:
          status === "rejected"
            ? [{ path: "root/working_sentence", review_response: { decision: "reject" } }]
            : [],
        artifacts: [],
        evidence_ids: [],
        workflow: { nodes: [] },
        research_manifest: {
          settings: { model: "synthetic", limits: { max_model_calls: 30 } },
          evidence: [],
          tool_config: { session: "brief-led-1" },
        },
        model_attempts: attempts,
      },
    }),
  );
  const outputRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      path.startsWith("/api/artifacts/") ||
      path.startsWith("/api/providers/") ||
      path.endsWith("/report.zip")
    )
      outputRequests.push(path);
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const bookmark = `/?session=${runId}&workspace=agent-1&pass=${researcher.id}`;
  await page.goto(bookmark);
  const navigation = page.getByRole("navigation", { name: "Study sections", exact: true });
  const findings = navigation.getByRole("link", { name: "Read editor findings", exact: true });
  const runStatus = page.getByRole("status", { name: "Run status", exact: true });
  await expect(runStatus).toHaveText("Completed");
  await expect(findings).toBeInViewport();
  const editorHref = `/?session=${runId}&workspace=editor&pass=${editor.id}#current-research-workspace`;
  await expect(findings).toHaveAttribute("href", editorHref);
  await expect(navigation.getByRole("link", { name: "Read report", exact: true })).toHaveCount(0);
  const bookmarked = page.getByRole("region", { name: "Inventory checks workspace" });
  await expect(bookmarked.getByRole("region", { name: "Pass 1", exact: true })).toContainText(
    researcher.result!.conclusion,
  );
  expect(new URL(page.url()).searchParams.get("pass")).toBe(researcher.id);

  await findings.click();
  const workspace = page.getByRole("region", { name: "Report editor workspace" });
  await expect(workspace).toBeFocused();
  const savedPass = workspace.getByRole("region", { name: "Pass 2", exact: true });
  await expect(savedPass).toContainText(conclusion);
  await expect(savedPass.getByRole("link", { name: "Saved request", exact: true })).toHaveAttribute(
    "href",
    new RegExp(editor.input_artifact_id),
  );
  await expect(
    savedPass.getByRole("link", { name: "Saved response", exact: true }),
  ).toHaveAttribute("href", new RegExp(editor.response_artifact_id));
  expect(new URL(page.url()).searchParams.get("pass")).toBe(editor.id);
  await page.reload();
  await expect(savedPass).toContainText(conclusion);
  expect(outputRequests).toEqual([]);

  // A partial editor result, a parked study and an editor workspace with files
  // each retain their existing routes and controls.
  status = "running";
  attempts = [plan, researcher, partial];
  await page.goto(bookmark);
  await expect(runStatus).toHaveText("Running");
  await expect(findings).toHaveCount(0);

  status = "rejected";
  attempts = [];
  await page.reload();
  await expect(runStatus).toHaveText("Parked");
  await expect(findings).toHaveCount(0);

  status = "completed";
  attempts = [
    plan,
    researcher,
    {
      ...editor,
      result: {
        ...editor.result!,
        workspace_files: [
          {
            name: "observations.csv",
            artifact_id: crypto.randomUUID(),
            media_type: "text/csv",
            byte_size: 24,
          },
        ],
      },
    },
  ];
  await page.reload();
  await expect(runStatus).toHaveText("Completed");
  await expect(findings).toHaveCount(0);
  await expect(bookmarked).toContainText(researcher.result!.conclusion);
  expect(outputRequests).toEqual([]);
});
