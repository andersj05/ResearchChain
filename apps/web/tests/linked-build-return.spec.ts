import demo from "../../../examples/research-workflow.json";
import type { AgentDetail, AgentVersion, Workflow, WorkflowRevision } from "../src/lib/workflow";
import { expect, test, type Page } from "./fixtures";

const created_at = "2026-11-24T13:04:00Z";
const linkedStep = "Opening assumptions for version 7";
const otherStep = "Opening assumptions for the other agent";
const studyTitle = "Archived duration study";

function revision(number: number, label: string): WorkflowRevision {
  const workflow = structuredClone(demo) as Workflow;
  workflow.nodes.find((node) => node.id === workflow.start_node)!.label = label;
  return {
    id: crypto.randomUUID(),
    number,
    workflow,
    name: workflow.name,
    created_at,
    content_hash: number.toString(16).padStart(64, "0"),
  };
}

async function workspace(page: Page, prefix: string) {
  const old = revision(107, linkedStep);
  const head = revision(112, "Current opening assumptions");
  const first = revision(101, "First opening assumptions");
  const otherRevision = revision(113, otherStep);
  const unassigned = revision(114, "Unassigned workflow fallback");
  const detail = (name: string, revision: WorkflowRevision, version: number): AgentDetail => ({
    agent: {
      id: crypto.randomUUID(),
      name,
      revision_id: revision.id,
      version,
      created_at,
      updated_at: created_at,
    },
    revision,
  });
  const named = detail("Synthetic duration agent", head, 12);
  const other = detail("Synthetic credit agent", otherRevision, 1);
  const versions: AgentVersion[] = [
    { version: 12, revision: head },
    { version: 7, revision: old },
    { version: 1, revision: first },
  ];
  const context = page.context();
  await context.route("**/api/agents?*", (route) =>
    route.fulfill({ json: [named.agent, other.agent] }),
  );
  for (const item of [named, other]) {
    await context.route(`**/api/agents/${item.agent.id}`, (route) => route.fulfill({ json: item }));
    await context.route(`**/api/agents/${item.agent.id}/revisions?*`, (route) =>
      route.fulfill({
        json: item === named ? versions : [{ version: 1, revision: otherRevision }],
      }),
    );
  }
  await context.route("**/api/revisions", (route) => route.fulfill({ json: [unassigned] }));
  await context.route("**/api/revisions/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    const found = [old, unassigned].find((candidate) => candidate.id === id);
    return found ? route.fulfill({ json: found }) : route.fulfill({ status: 404 });
  });
  await context.route("**/api/runs?agent_id=*", (route) => route.fulfill({ json: [] }));
  await context.route("**/api/runs", (route) => route.fulfill({ json: [] }));
  const agent = page.getByRole("combobox", { name: "Agent", exact: true });
  const step = page.getByRole("textbox", { name: "Step name", exact: true });
  const key = `${prefix}.active-agent`;
  return {
    context,
    namedId: named.agent.id,
    otherId: other.agent.id,
    otherRevision,
    old,
    agent,
    step,
    url: `/?view=workflow&agent=${named.agent.id}&revision=${old.id}`,
    readAgent: (tab: Page = page) => tab.evaluate((name) => localStorage.getItem(name), key),
    readDraft: () =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
        `${prefix}.agent-draft.${named.agent.id}`,
      ),
  };
}

async function openArchivedStudy(page: Page) {
  const run = {
    id: crypto.randomUUID(),
    revision_id: crypto.randomUUID(),
    revision_number: 1,
    workflow_name: "Research session",
    study_title: studyTitle,
    status: "completed",
    created_at,
  };
  await page.route("**/api/runs/search?*", (route) =>
    route.fulfill({
      json: { items: [{ run, brief_excerpt: "Synthetic archived results." }], has_more: false },
    }),
  );
  await page.route(`**/api/runs/${run.id}`, (route) =>
    route.fulfill({
      json: {
        ...run,
        brief: "Synthetic saved study for navigation checking.",
        execution_pending: false,
        workflow: { nodes: [], edges: [] },
        events: [],
        artifacts: [],
        evidence_ids: [],
        model_attempts: [],
        research_manifest: {
          account_id: "synthetic-account",
          account_label: "Synthetic connection",
          tool_config: { session: "brief-led-1" },
          evidence: [],
          settings: { model: "test-model", limits: { max_model_calls: 25 } },
        },
      },
    }),
  );
  await page.getByRole("link", { name: "Research desk", exact: true }).press("Enter");
  await page.getByRole("link", { name: "Studies", exact: true }).press("Enter");
  await page.getByRole("link", { name: new RegExp(studyTitle) }).press("Enter");
  await expect(page).toHaveURL(`/?session=${run.id}`);
  await expect(page.getByRole("heading", { name: studyTitle, exact: true })).toBeFocused();
}

for (const width of [390, 1440]) {
  test(`return from a saved study to the exact linked agent version at ${width}px`, async ({
    page,
    ownerSession,
  }) => {
    const fixture = await workspace(page, ownerSession.prefix);
    page.on("dialog", (dialog) => dialog.accept());
    const activity: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") activity.push(new URL(request.url()).pathname);
    });
    await page.setViewportSize({ width, height: 844 });
    await page.goto(fixture.url);
    await expect(fixture.step).toHaveValue(linkedStep);
    await expect(fixture.agent).toHaveValue(fixture.namedId);
    await expect.poll(() => fixture.readAgent()).toBe(fixture.namedId);
    await expect(page.locator(".save-state")).toHaveText("Version 7");
    const edited = width === 1440 ? "Unfinished note for version 7" : linkedStep;
    if (edited !== linkedStep) await fixture.step.fill(edited);
    await expect
      .poll(async () => {
        const cached = await fixture.readDraft();
        return [cached?.revision?.id, cached?.workflow?.nodes?.[0]?.label];
      })
      .toEqual([fixture.old.id, edited]);

    await openArchivedStudy(page);
    await page.getByRole("link", { name: "Workflows", exact: true }).press("Enter");
    await expect(page).toHaveURL("/?view=workflow");
    await expect(fixture.agent).toHaveValue(fixture.namedId);
    await expect(fixture.step).toHaveValue(edited);
    await expect(page.locator(".save-state")).toHaveText(
      edited === linkedStep ? "Version 7" : "Unsaved draft",
    );
    await expect(page.getByRole("button", { name: "Run workflow", exact: true })).toBeInViewport();
    expect((await fixture.readDraft()).revision.id).toBe(fixture.old.id);
    expect(activity).toEqual([]);
  });
}

test("an exact load completing late preserves a newer Agent selection", async ({
  page,
  ownerSession,
}) => {
  const fixture = await workspace(page, ownerSession.prefix);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route(`**/api/revisions/${fixture.old.id}`, async (route) => {
    started.resolve();
    await release.promise;
    return route.fallback();
  });
  const otherTab = await fixture.context.newPage();
  try {
    await page.goto(fixture.url);
    await started.promise;
    await otherTab.goto("/?view=workflow");
    const choice = otherTab.getByRole("combobox", { name: "Agent", exact: true });
    await choice.selectOption(fixture.otherId);
    await expect(otherTab.getByRole("textbox", { name: "Step name" })).toHaveValue(otherStep);
    await expect.poll(() => fixture.readAgent(otherTab)).toBe(fixture.otherId);
    release.resolve();
    await expect(fixture.step).toHaveValue(linkedStep);
    await expect(fixture.agent).toHaveValue(fixture.namedId);
    await expect(fixture.agent).toBeEnabled();
    expect(await fixture.readAgent()).toBe(fixture.otherId);
  } finally {
    release.resolve();
    await otherTab.close();
  }
});

test("a missing or mismatched exact revision leaves the previous Agent preference intact", async ({
  page,
  ownerSession,
}) => {
  const fixture = await workspace(page, ownerSession.prefix);
  await page.goto("/?view=workflow");
  await fixture.agent.selectOption(fixture.otherId);
  await expect.poll(() => fixture.readAgent()).toBe(fixture.otherId);
  let missing = true;
  await page.route(`**/api/revisions/${fixture.old.id}`, (route) =>
    missing
      ? route.fulfill({ status: 404, json: { detail: "Synthetic exact revision missing." } })
      : route.fulfill({ json: fixture.otherRevision }),
  );
  for (const error of [
    "Synthetic exact revision missing.",
    "The requested workflow revision could not be verified.",
  ]) {
    await page.goto(fixture.url);
    await expect(page.getByRole("alert").filter({ hasText: error })).toBeVisible();
    expect(await fixture.readAgent()).toBe(fixture.otherId);
    missing = false;
  }
});
