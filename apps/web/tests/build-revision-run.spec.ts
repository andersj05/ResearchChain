import { expect, test, type APIRequestContext } from "./fixtures";
import example from "../../../examples/research-workflow.json";
import type {
  AgentDetail,
  RunRequest,
  RunSnapshot,
  Workflow,
  WorkflowRevision,
} from "../src/lib/workflow";

const replacesLatest = "Starting saves this workflow as the latest version of this agent.";

function ratesWorkflow(name: string): Workflow {
  const workflow = example as Workflow;
  return {
    ...workflow,
    name,
    nodes: workflow.nodes.filter((node) => ["frame", "finish"].includes(node.id)),
    edges: [{ source: "frame", source_port: "next", target: "finish", target_port: "in" }],
  };
}

async function createAgent(request: APIRequestContext, workflow: Workflow): Promise<AgentDetail> {
  const response = await request.post("/api/agents", {
    data: { id: crypto.randomUUID(), workflow },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function saveAgent(
  request: APIRequestContext,
  detail: AgentDetail,
  workflow: Workflow,
): Promise<AgentDetail> {
  const response = await request.post(`/api/agents/${detail.agent.id}/revisions`, {
    data: { expected_version: detail.agent.version, workflow },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function queueRun(
  request: APIRequestContext,
  revision: WorkflowRevision,
  brief: string,
  agentId: string | null,
) {
  const id = crypto.randomUUID();
  const response = await request.post("/api/runs", {
    data: { id, revision_id: revision.id, agent_id: agentId, brief },
  });
  expect(response.status()).toBe(202);
  return id;
}

test("Build opens the recent run for the exact agent and saved revision", async ({
  page,
  request,
}) => {
  const first = await createAgent(request, ratesWorkflow("Named rates experiment"));
  const latestWorkflow = structuredClone(first.revision.workflow);
  const savedInstructions = "Compare the saved duration and breakeven assumptions.";
  latestWorkflow.nodes[0]!.instructions = savedInstructions;
  const current = await saveAgent(request, first, latestWorkflow);
  const other = await createAgent(request, latestWorkflow);
  expect(other.agent.id).not.toBe(current.agent.id);
  expect(other.revision.id).toBe(current.revision.id);

  await queueRun(request, current.revision, "Earlier matching rates run", current.agent.id);
  const recentBrief = "Recent matching rates run";
  const chosen = await queueRun(request, current.revision, recentBrief, current.agent.id);
  await queueRun(request, first.revision, "Newer run of a different revision", current.agent.id);
  await queueRun(request, other.revision, "Other agent with the same revision", other.agent.id);
  await expect
    .poll(async () => {
      const run: RunSnapshot = await (await request.get(`/api/runs/${chosen}`)).json();
      return run.status;
    })
    .toBe("completed");

  await page.setViewportSize({ width: 390, height: 950 });
  await page.goto(`/?agent=${current.agent.id}&view=workflow`);
  const runButton = page.getByRole("button", {
    name: `Recent run · saved version ${current.agent.version}`,
    exact: true,
  });
  const instructions = page.getByRole("textbox", { name: "Instructions", exact: true });
  const build = page.getByRole("tab", { name: "Build", exact: true });
  const undo = page.getByRole("button", { name: "Undo last edit", exact: true });
  await expect(instructions).toHaveValue(savedInstructions);
  const unsaved = "Check liquidity separately in this unsaved draft.";
  await instructions.fill(unsaved);
  await expect(page.locator(".save-state")).toHaveText("Unsaved draft");
  await expect(runButton).toHaveAttribute("title", recentBrief);
  await build.scrollIntoViewIfNeeded();
  await expect(runButton).toBeInViewport();
  await expect(page.getByRole("button", { name: "Save revision", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Run workflow", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  const browserPosts: string[] = [];
  const historyReads: string[] = [];
  page.on("request", (entry) => {
    const path = new URL(entry.url()).pathname;
    if (entry.method() === "POST") browserPosts.push(path);
    if (entry.method() === "GET" && path === "/api/runs") historyReads.push(path);
  });
  await runButton.press("Enter");
  await expect(page.getByRole("tab", { name: "Runs", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const inspected = new URL(page.url()).searchParams;
  expect(inspected.get("run")).toBe(chosen);
  expect(inspected.get("agent")).toBe(current.agent.id);
  expect(inspected.get("revision")).toBe(current.revision.id);
  await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Completed");
  await build.click();
  await expect(instructions).toHaveValue(unsaved);
  await expect(undo).toBeEnabled();
  expect(browserPosts).toEqual([]);
  expect(historyReads).toEqual([]);
  await undo.click();
  await expect(instructions).toHaveValue(savedInstructions);
  await page.getByRole("button", { name: "Redo last edit", exact: true }).click();
  await expect(instructions).toHaveValue(unsaved);
  await page.reload();
  await expect(instructions).toHaveValue(unsaved);
});

test("show the loaded named version in Build and setup across switching and recovery", async ({
  page,
  request,
}) => {
  const workflow = ratesWorkflow("Versioned rate assumptions");
  const first = await createAgent(request, workflow);
  const earlierInstructions = first.revision.workflow.nodes[0]!.instructions;
  const latestInstructions = "Inspect the latest synthetic risk assumptions.";
  const amended = structuredClone(first.revision.workflow);
  amended.nodes[0]!.instructions = latestInstructions;
  await saveAgent(request, first, amended);
  const other = await createAgent(request, ratesWorkflow("Another agent"));

  const mutations: string[] = [];
  page.on("request", (entry) => {
    const { pathname } = new URL(entry.url());
    if (pathname.startsWith("/api/") && entry.method() === "POST") mutations.push(pathname);
  });
  await page.setViewportSize({ width: 390, height: 950 });
  await page.goto(`/?agent=${first.agent.id}&view=workflow`);
  const badge = page.locator(".save-state");
  const instructions = page.getByRole("textbox", { name: "Instructions", exact: true });
  const launch = page.getByRole("button", { name: "Run workflow", exact: true });
  const dialog = page.getByRole("dialog", { name: "Start a research run" });
  const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
  const agents = page.getByRole("combobox", { name: "Agent", exact: true });
  await expect(instructions).toHaveValue(latestInstructions);
  await expect(badge).toHaveText("Version 2");
  await launch.press("Enter");
  await expect(dialog.getByText("Version 2", { exact: true })).toBeVisible();
  await expect(dialog.getByText(replacesLatest, { exact: true })).toHaveCount(0);
  await cancel.click();

  await page.getByRole("tab", { name: "Versions", exact: true }).click();
  await page
    .getByRole("button", { name: `Load revision ${first.revision.number}`, exact: true })
    .click();
  await expect(instructions).toHaveValue(earlierInstructions);
  await expect(badge).toHaveText("Version 1");
  await launch.press("Enter");
  await expect(dialog.getByText("Version 1", { exact: true })).toBeVisible();
  await expect(dialog.getByText(replacesLatest, { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Start run", exact: true }),
  ).toHaveAccessibleDescription(replacesLatest);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await cancel.click();

  await agents.selectOption(other.agent.id);
  await expect(agents).toHaveValue(other.agent.id);
  await expect(badge).toHaveText("Version 1");
  await agents.selectOption(first.agent.id);
  await expect(agents).toHaveValue(first.agent.id);
  await expect(instructions).toHaveValue(earlierInstructions);
  await page.reload();
  await expect(instructions).toHaveValue(earlierInstructions);
  await expect(badge).toHaveText("Version 1");

  await instructions.fill("Keep these unversioned notes only in the draft.");
  await page.reload();
  await expect(instructions).toHaveValue("Keep these unversioned notes only in the draft.");
  await expect(badge).toHaveText("Unsaved draft");
  await launch.press("Enter");
  await expect(dialog.getByText("New version on start", { exact: true })).toBeVisible();
  await expect(dialog.getByText(replacesLatest, { exact: true })).toHaveCount(0);
  await cancel.click();
  expect(mutations).toEqual([]);
});

test("identify a revision shared by multiple named versions without guessing a version", async ({
  page,
  request,
}) => {
  const first = await createAgent(request, ratesWorkflow("Restored rate assumptions"));
  const amended = structuredClone(first.revision.workflow);
  amended.nodes[0]!.instructions = "Inspect the synthetic second version.";
  const second = await saveAgent(request, first, amended);
  await page.goto(`/?agent=${first.agent.id}&view=workflow`);
  const badge = page.locator(".save-state");
  await expect(badge).toHaveText("Version 2");

  const reverted = await saveAgent(request, second, first.revision.workflow);
  expect(reverted.agent.version).toBe(3);
  expect(reverted.revision.id).toBe(first.revision.id);
  // The saved-version view refreshes its history when it opens the revision.
  await page.getByRole("tab", { name: "Versions", exact: true }).click();
  await page
    .getByRole("button", { name: `Load revision ${first.revision.number}`, exact: true })
    .click();
  const revisionLabel = `Revision ${first.revision.number}`;
  await expect(badge).toHaveText(revisionLabel);
  await page.getByRole("button", { name: "Run workflow", exact: true }).press("Enter");
  const dialog = page.getByRole("dialog", { name: "Start a research run" });
  await expect(dialog.getByText(revisionLabel, { exact: true })).toBeVisible();
  await expect(dialog.getByText(replacesLatest, { exact: true })).toHaveCount(0);
});

test("retry a pending historical run with its exact revision and without replacing the latest", async ({
  page,
  request,
  ownerSession,
}) => {
  const first = await createAgent(request, ratesWorkflow("Retry a saved rates run"));
  const amended = structuredClone(first.revision.workflow);
  amended.nodes[0]!.instructions = "Use these synthetic instructions in the latest version.";
  const second = await saveAgent(request, first, amended);
  const pending: RunRequest = {
    id: crypto.randomUUID(),
    revision_id: first.revision.id,
    agent_id: first.agent.id,
    brief: "Retry the synthetic run with its original brief.",
    evidence_ids: [],
    artifacts: [],
    provider_account_id: null,
  };
  await page.addInitScript(
    ({ key, pending }) => sessionStorage.setItem(key, JSON.stringify(pending)),
    { key: ownerSession.prefix + ".run.pending", pending },
  );
  await page.goto(`/?view=workflow&agent=${first.agent.id}&run=${pending.id}`);
  await expect(page.locator(".save-state")).toHaveText("Version 1");
  await page.getByRole("button", { name: "Run workflow", exact: true }).press("Enter");
  const dialog = page.getByRole("dialog", { name: "Start a research run" });
  await expect(dialog.getByText("Version 1", { exact: true })).toBeVisible();
  await expect(dialog.getByText(replacesLatest, { exact: true })).toHaveCount(0);
  const posted = page.waitForRequest(
    (entry) => new URL(entry.url()).pathname === "/api/runs" && entry.method() === "POST",
  );
  await dialog.getByRole("button", { name: "Start run", exact: true }).click();
  expect((await posted).postDataJSON()).toEqual(pending);
  await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Completed");
  const latest = await (await request.get(`/api/agents/${first.agent.id}`)).json();
  expect(latest.agent.version).toBe(second.agent.version);
  expect(latest.revision.id).toBe(second.revision.id);
});

test("unassigned Build uses matching unassigned runs from refreshed history", async ({
  page,
  request,
}) => {
  const agent = await createAgent(request, ratesWorkflow("Shared breakeven workflow"));
  await queueRun(request, agent.revision, "A named run on the shared revision", agent.agent.id);
  await page.goto(`/?revision=${agent.revision.id}&view=workflow`);
  await expect(page.getByRole("button", { name: "Save revision", exact: true })).toBeEnabled();
  const runButton = page.getByRole("button", { name: /^Recent run · saved revision/ });
  await expect(runButton).toHaveCount(0);

  const unassignedBrief = "An unassigned run on the shared revision";
  const chosen = await queueRun(request, agent.revision, unassignedBrief, null);
  await queueRun(request, agent.revision, "A newer named run on the same revision", agent.agent.id);
  await expect(runButton).toHaveCount(0);
  await page.getByRole("tab", { name: "Runs", exact: true }).click();
  await page.getByRole("button", { name: "Refresh history", exact: true }).click();
  await expect(page.getByRole("status", { name: "Workspace status" })).toHaveText(
    "History refreshed.",
  );
  await page.getByRole("tab", { name: "Build", exact: true }).click();
  await expect(runButton).toHaveAttribute("title", unassignedBrief);
  await runButton.click();
  await expect(page.getByLabel("Run agent", { exact: true })).toHaveText("Unassigned workflow");
  expect(new URL(page.url()).searchParams.get("run")).toBe(chosen);
});
