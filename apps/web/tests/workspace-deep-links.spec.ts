import { initialWorkflow, type AgentDetail } from "../src/lib/workflow";
import { expect, test, type APIRequestContext, type Page } from "./fixtures";
import { runRequest } from "./run-fixture";

async function holdRevisionHistory(page: Page) {
  const { promise, resolve } = Promise.withResolvers<void>();
  await page.route(
    (url) => url.pathname === "/api/revisions",
    async (route) => {
      await promise;
      await route.continue();
    },
  );
  return resolve;
}

async function savedAgent(request: APIRequestContext, stepLabel: string) {
  const workflow = structuredClone(initialWorkflow);
  workflow.name = "Synthetic research workflow";
  workflow.nodes.find((node) => node.id === workflow.start_node)!.label = stepLabel;
  const response = await request.post("/api/agents", {
    data: { id: crypto.randomUUID(), workflow },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as AgentDetail;
}

test("direct Reports opens during unrelated startup reads", async ({ page }) => {
  const release = await holdRevisionHistory(page);
  try {
    const pendingHistory = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/api/revisions",
    );
    await page.goto("/?view=reports");
    await pendingHistory;
    await expect(page.getByRole("tab", { name: "Reports", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("button", { name: "Style guides", exact: true })).toBeEnabled();
    await expect(page.locator('[aria-label="Workflow editor"]')).toHaveCount(0);
    await page.getByRole("tab", { name: "Sources", exact: true }).click();
    release();
    await expect(page.getByRole("button", { name: "New agent", exact: true })).toBeEnabled();
    await expect(page.getByRole("tab", { name: "Sources", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("tab", { name: "Build", exact: true }).click();
    await expect(page.getByRole("region", { name: "Workflow editor" })).toBeVisible();
    await page.getByRole("tab", { name: "Reports", exact: true }).click();
    await expect(page.locator('[aria-label="Workflow editor"]')).toHaveCount(1);
    await expect(page.locator('[aria-label="Workflow editor"]')).toBeHidden();
  } finally {
    release();
  }
});

test("a linked run can be read while revision history loads", async ({ page, request }) => {
  const revision = await request.post("/api/revisions", { data: initialWorkflow });
  expect(revision.status()).toBe(201);
  const id = crypto.randomUUID();
  const run = await runRequest(request, "/api/runs", {
    data: { id, revision_id: (await revision.json()).id, brief: "Synthetic saved run" },
  });
  expect(run.status()).toBe(200);
  const release = await holdRevisionHistory(page);
  try {
    await page.goto(`/?view=runs&run=${id}`);
    await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Completed");
    const iterate = page.getByRole("button", { name: "Iterate from this run", exact: true });
    await expect(iterate).toBeDisabled();
    await expect(page.getByRole("searchbox", { name: "Find a recent run" })).toHaveCount(0);
    release();
    await expect(iterate).toBeEnabled();
    await expect(page.getByRole("searchbox", { name: "Find a recent run" })).toBeVisible();
  } finally {
    release();
  }
});

for (const { view, destination, action } of [
  { view: "reports", destination: "Reports", action: "Style guides" },
  { view: "evidence", destination: "Sources", action: "Add source" },
]) {
  test(`direct ${destination} reuses the exact named agent head`, async ({ page, request }) => {
    const saved = await savedAgent(request, "Inspect the saved agent head");
    const duplicatePath = `/api/revisions/${saved.revision.id}`;
    let headReads = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === duplicatePath) headReads += 1;
    });
    const release = await holdRevisionHistory(page);
    try {
      const pending = page.waitForRequest(
        (request) => new URL(request.url()).pathname === "/api/revisions",
      );
      await page.goto(`/?view=${view}&agent=${saved.agent.id}`);
      await pending;
      await expect(page.getByRole("tab", { name: destination, exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(page.getByRole("button", { name: action, exact: true })).toBeEnabled();
      const agent = page.getByRole("combobox", { name: "Agent", exact: true });
      await expect(agent).toBeDisabled();
      release();
      await expect(agent).toHaveValue(saved.agent.id);
      await expect(agent).toBeEnabled();
      await page.getByRole("tab", { name: "Build", exact: true }).click();
      await expect(page.getByRole("button", { name: "Run workflow", exact: true })).toBeEnabled();
      await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(
        "Inspect the saved agent head",
      );
      expect(headReads).toBe(0);
    } finally {
      release();
    }
  });
}

test("named history and run links still fetch their exact older revision", async ({
  page,
  request,
}) => {
  const older = await savedAgent(request, "Inspect the older saved step");
  const changed = structuredClone(older.revision.workflow);
  changed.nodes.find((node) => node.id === changed.start_node)!.label = "Inspect the newer head";
  const updated = await request.post(`/api/agents/${older.agent.id}/revisions`, {
    data: { expected_version: older.agent.version, workflow: changed },
  });
  expect(updated.status()).toBe(201);
  const head: AgentDetail = await updated.json();
  const runId = crypto.randomUUID();
  const result = await runRequest(request, "/api/runs", {
    data: {
      id: runId,
      agent_id: older.agent.id,
      revision_id: older.revision.id,
      brief: "Read a synthetic run from an older named version.",
    },
  });
  expect(result.status()).toBe(200);
  const revisionReads: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/revisions/")) revisionReads.push(path);
  });
  const olderPath = `/api/revisions/${older.revision.id}`;
  const assertOlderBuild = async () => {
    await expect(page.getByRole("button", { name: "Run workflow", exact: true })).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(
      "Inspect the older saved step",
    );
    await expect(page.locator(".save-state")).toHaveText("Version 1");
  };

  await page.goto(`/?view=workflow&agent=${older.agent.id}&revision=${older.revision.id}`);
  await assertOlderBuild();
  expect(revisionReads).toEqual([olderPath]);
  await page.goto(`/?view=runs&run=${runId}`);
  await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Completed");
  await page.getByRole("tab", { name: "Build", exact: true }).click();
  await assertOlderBuild();
  expect(revisionReads).toEqual([olderPath, olderPath]);
  expect(head.revision.id).not.toBe(older.revision.id);

  const unrelated = await request.post("/api/revisions", {
    data: { ...initialWorkflow, name: "Unrelated synthetic workflow" },
  });
  expect(unrelated.status()).toBe(201);
  const { id } = await unrelated.json();
  await page.goto(`/?view=workflow&agent=${older.agent.id}&revision=${id}`);
  await expect(
    page.getByRole("alert").filter({
      hasText: "This revision does not belong to the selected agent.",
    }),
  ).toBeVisible();
  expect(revisionReads).toEqual([olderPath, olderPath]);
});
