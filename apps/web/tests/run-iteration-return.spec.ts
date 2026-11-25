import { expect, test, type Locator } from "./fixtures";
import {
  discretionaryMacroWorkflow,
  type RunSnapshot,
  type WorkflowNode,
} from "../src/lib/workflow";
import { addTemplate, referenceOf } from "../src/lib/workflow-editing";

async function readPosition(button: Locator) {
  return button.evaluate((element) => {
    const pane = element.closest(".run-reading-pane")!;
    const target = element.getBoundingClientRect();
    const paneBounds = pane.getBoundingClientRect();
    return {
      pageY: Math.round(window.scrollY),
      paneY: Math.round(pane.scrollTop),
      rowTop: Math.round(target.top),
      inView:
        target.top >= Math.max(0, paneBounds.top) &&
        target.bottom <= Math.min(innerHeight, paneBounds.bottom),
    };
  });
}

for (const width of [390, 1440]) {
  test(`return to the originating output after comparing exact iterations at ${width}px`, async ({
    page,
  }) => {
    const loop = addTemplate(structuredClone(discretionaryMacroWorkflow), null, "loop", "activity");
    const loopStep = loop.workflow.nodes.find((step) => step.id === loop.selected)!;
    loopStep.label = "Synthetic review loop";
    if (loopStep.config?.type === "loop") loopStep.config.max_iterations = 3;
    const body = addTemplate(loop.workflow, referenceOf(loopStep)!, "model", "pass");
    const createdAt = "2026-11-19T15:00:00Z";
    const notes = Array.from({ length: 44 }, (_, index): WorkflowNode => ({
      id: `fixture_note_${index + 1}`,
      kind: "note",
      label: `Synthetic note ${index + 1}`,
      instructions: "Review this synthetic observation.",
      position: { x: 50 + (index % 4) * 210, y: 700 + Math.floor(index / 4) * 130 },
    }));
    const paths = [1, 2, 3].map(
      (iteration) => `root/${loop.selected}/iteration-${iteration}/${body.selected}`,
    );
    const runName = "Synthetic saved receipts";
    const snapshot: RunSnapshot = {
      id: crypto.randomUUID(),
      revision_id: crypto.randomUUID(),
      revision_number: 1,
      workflow_name: runName,
      workflow: { ...body.workflow, name: runName, nodes: [...body.workflow.nodes, ...notes] },
      status: "completed",
      execution_pending: false,
      created_at: createdAt,
      compiler_version: "research-0.3.0",
      checkpoint_id: null,
      brief: "Review synthetic iteration receipts and return to their output row.",
      artifacts: [],
      events: [
        ...paths.map((path, index) => ({
          path,
          node_id: body.selected,
          label: "Model prompt",
          kind: "research" as const,
          detail: `Synthetic exact result ${index + 1}.`,
        })),
        ...notes.map((note) => ({
          node_id: note.id,
          label: note.label,
          kind: "note" as const,
          detail: "Synthetic note for an otherwise unrelated observation.",
        })),
      ],
      model_attempts: paths.map((path, index) => ({
        id: crypto.randomUUID(),
        path,
        model: "test-model",
        status: "completed",
        stage: "custom",
        input_bytes: 0,
        output_characters: `Synthetic exact result ${index + 1}.`.length,
        created_at: createdAt,
        result: {
          schema_version: "research-result-1",
          stage: "custom",
          conclusion: `Synthetic exact result ${index + 1}.`,
          hypotheses: [],
          unresolved_questions: [],
          evidence_requests: [],
          revision_summary: "",
          limitations: [],
        },
      })),
    };
    await page.route("**/api/runs", (route) =>
      route.fulfill({
        json: [
          {
            id: snapshot.id,
            revision_id: snapshot.revision_id,
            revision_number: snapshot.revision_number,
            workflow_name: snapshot.workflow_name,
            status: snapshot.status,
            created_at: snapshot.created_at,
            brief_excerpt: snapshot.brief,
          },
        ],
      }),
    );
    await page.route(`**/api/runs/${snapshot.id}`, (route) => route.fulfill({ json: snapshot }));
    await page.route(`**/api/revisions/${snapshot.revision_id}`, (route) =>
      route.fulfill({
        json: {
          id: snapshot.revision_id,
          name: runName,
          number: snapshot.revision_number,
          content_hash: "0".repeat(64),
          created_at: createdAt,
          workflow: snapshot.workflow,
        },
      }),
    );
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/?view=runs");
    const history = page.getByRole("complementary", { name: "Recent runs" });
    await history.getByRole("button", { name: /^Synthetic saved receipts/ }).press("Enter");
    await expect(page.getByRole("heading", { name: runName, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Outputs", exact: true }).click();
    const outputs = page.getByRole("region", { name: "Saved step outputs" });
    const search = outputs.getByRole("searchbox", { name: "Find an output" });
    await search.fill("synthetic");
    const rows = outputs.getByRole("listitem");
    await expect(rows).toHaveCount(40);
    await outputs.getByRole("button", { name: "Show more outputs" }).click();
    await expect(rows).toHaveCount(47);

    const opener = outputs
      .getByRole("listitem")
      .filter({ hasText: "Synthetic exact result 2." })
      .getByRole("button", { name: /^Compare iterations for/ });
    await opener.evaluate((element) =>
      element.scrollIntoView({ block: "center", inline: "nearest" }),
    );
    await opener.focus();
    const before = await readPosition(opener);
    expect(before.inView).toBe(true);
    expect(Math.max(before.pageY, before.paneY)).toBeGreaterThan(500);
    await opener.press("Enter");
    const comparison = page.getByRole("region", { name: "Compare saved iterations" });
    const earlier = comparison.getByRole("region", { name: "Earlier iteration", exact: true });
    const later = comparison.getByRole("region", { name: "Later iteration", exact: true });
    const back = comparison.getByRole("button", { name: "Back to outputs", exact: true });
    await expect(earlier).toContainText("Synthetic exact result 1.");
    await expect(later).toContainText("Synthetic exact result 2.");
    await comparison.getByRole("combobox", { name: "Later iteration" }).selectOption(paths[2]!);
    await expect(later).toContainText("Synthetic exact result 3.");
    await back.press("Enter");
    await expect(search).toHaveValue("synthetic");
    await expect(rows).toHaveCount(47);
    await expect(opener).toBeFocused();
    const after = await readPosition(opener);
    expect(after.inView).toBe(true);
    expect(Math.abs(after.rowTop - before.rowTop)).toBeLessThanOrEqual(12);

    const [first, , last] = snapshot.model_attempts!;
    const bookmark = new URLSearchParams({
      view: "runs",
      run: snapshot.id,
      iterations: `${first!.id},${last!.id}`,
    });
    await page.goto(`/?${bookmark}`);
    await expect(earlier).toContainText("Synthetic exact result 1.");
    await expect(later).toContainText("Synthetic exact result 3.");
    await back.press("Enter");
    await expect(rows).toHaveCount(40);
    await expect(page.locator(".run-reading-pane")).toBeFocused();
    expect(new URL(page.url()).searchParams.has("iterations")).toBe(false);
  });
}
