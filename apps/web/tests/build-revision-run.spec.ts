import { expect, test, type APIRequestContext } from "./fixtures";
import example from "../../../examples/research-workflow.json";
import type { AgentDetail, RunSnapshot, Workflow, WorkflowRevision } from "../src/lib/workflow";

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
  const response = await request.post(`/api/agents/${first.agent.id}/revisions`, {
    data: { expected_version: first.agent.version, workflow: latestWorkflow },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const current: AgentDetail = await response.json();
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
    name: `Recent run · saved revision ${current.revision.number}`,
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
