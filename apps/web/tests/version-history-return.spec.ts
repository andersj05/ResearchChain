import { expect, test } from "./fixtures";
import type { AgentDetail, AgentVersion, Workflow, WorkflowRevision } from "../src/lib/workflow";

const historySize = 48;
const selectedVersion = 7;
const savedAt = new Date("2026-11-24T12:00:00Z").toISOString();

function workflowFor(version: number): Workflow {
  return {
    schema_version: "0.2",
    name: "Synthetic rates workflow",
    start_node: "step-0",
    nodes: Array.from({ length: 36 }, (_, index) => ({
      id: `step-${index}`,
      kind: index === 35 ? "finish" : "note",
      label: index === 0 ? `Opening note for version ${version}` : `Set up research step ${index}`,
      instructions: "Synthetic workflow instructions for this audit.",
      position: { x: index * 180, y: 40 },
    })),
    edges: Array.from({ length: 35 }, (_, index) => ({
      source: `step-${index}`,
      source_port: "next",
      target: `step-${index + 1}`,
      target_port: "in",
    })),
  };
}

for (const width of [390, 1440]) {
  test(`focus Build after loading an older version at ${width}px`, async ({ page }) => {
    const agentId = crypto.randomUUID();
    const versions: AgentVersion[] = Array.from({ length: historySize }, (_, index) => {
      const version = historySize - index;
      return {
        version,
        revision: {
          id: crypto.randomUUID(),
          number: version + 100,
          content_hash: version.toString(16).padStart(64, "0"),
          name: "Synthetic rates workflow",
          created_at: savedAt,
        },
      };
    });
    const chosen = versions.find((item) => item.version === selectedVersion)!;
    const head = versions[0]!;
    const detail: AgentDetail = {
      agent: {
        id: agentId,
        name: head.revision.name,
        revision_id: head.revision.id,
        version: head.version,
        created_at: savedAt,
        updated_at: savedAt,
      },
      revision: { ...head.revision, workflow: workflowFor(head.version) },
    };
    await page.route("**/api/agents?*", (route) => route.fulfill({ json: [detail.agent] }));
    await page.route(`**/api/agents/${agentId}`, (route) => route.fulfill({ json: detail }));
    await page.route(`**/api/agents/${agentId}/revisions?*`, (route) =>
      route.fulfill({ json: versions }),
    );
    await page.route("**/api/revisions/*", (route) => {
      const record = versions.find((item) => route.request().url().endsWith(item.revision.id));
      if (!record) return route.fulfill({ status: 404 });
      const revision: WorkflowRevision = {
        ...record.revision,
        workflow: workflowFor(record.version),
      };
      return route.fulfill({ json: revision });
    });
    const mutations: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() === "POST" && path.startsWith("/api/")) mutations.push(path);
    });

    await page.setViewportSize({ width, height: width === 390 ? 640 : 960 });
    await page.goto(`/?agent=${agentId}&view=workflow`);
    const stepName = page.getByRole("textbox", { name: "Step name", exact: true });
    await expect(stepName).toHaveValue(`Opening note for version ${historySize}`);
    await stepName.fill("Unsaved opening note");
    await page.getByRole("tab", { name: "Versions", exact: true }).click();
    const versionsTab = page.getByRole("tabpanel", { name: "Versions", exact: true });
    await expect(versionsTab.getByRole("row")).toHaveCount(historySize + 1);
    const load = versionsTab.getByRole("button", {
      name: `Load revision ${chosen.revision.number}`,
      exact: true,
    });
    await load.scrollIntoViewIfNeeded();
    const scrolled = await versionsTab.evaluate((element) => window.scrollY || element.scrollTop);
    expect(scrolled).toBeGreaterThan(1500);
    await load.press("Enter");
    const status = page.getByRole("status", { name: "Workspace status" });
    await expect(status).toHaveText(
      `Loaded revision ${chosen.revision.number}. Undo restores your previous draft.`,
    );
    await expect(stepName).toHaveValue(`Opening note for version ${selectedVersion}`);
    await expect(page).toHaveURL(new RegExp(`revision=${chosen.revision.id}`));
    await expect(page.locator(".save-state")).toHaveText(`Version ${selectedVersion}`);
    await expect(status).toBeFocused();
    await expect(status).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Dismiss status" })).toBeFocused();
    await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
    await expect(stepName).toHaveValue("Unsaved opening note");
    expect(mutations).toEqual([]);
  });
}
