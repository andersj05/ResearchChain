import { expect, test } from "./fixtures";
import type { RunSnapshot } from "../src/lib/workflow";
import workflow from "../../../examples/idea-research.json";

for (const width of [1440, 390]) {
  test(`idea example retains web settings and sources through reviews at ${width}px`, async ({
    page,
    request,
  }, info) => {
    test.setTimeout(90000);
    const agent = await (
      await request.post("/api/agents", {
        data: { id: crypto.randomUUID(), workflow: { ...workflow, name: `Idea example ${width}` } },
      })
    ).json();
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/?agent=${agent.agent.id}`);
    await page.getByRole("button", { name: "Use idea research example", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(
      "Frame my idea",
    );
    const webToggle = page.getByRole("combobox", { name: "Web and market search", exact: true });
    await expect(webToggle).toHaveValue("auto");
    await webToggle.selectOption("true");
    const sec = page.getByRole("checkbox", { name: "SEC financial statements", exact: true });
    await sec.check();
    await page
      .getByRole("combobox", { name: "Step behavior", exact: true })
      .selectOption("hypothesize");
    await expect(webToggle).toBeHidden();
    await page.getByRole("combobox", { name: "Step behavior", exact: true }).selectOption("custom");
    await expect(webToggle).toHaveValue("false");
    await expect(sec).not.toBeChecked();
    await page.getByRole("button", { name: "Validate workflow", exact: true }).click();
    await expect(page.getByRole("status", { name: "Workspace status" })).toHaveText(
      "Workflow valid. Ready to run.",
    );
    await page.getByRole("button", { name: "Run workflow", exact: true }).click();
    await page.getByText("External research tools · 1 step", { exact: true }).click();
    await expect(
      page.getByText("required web search, optional SEC lookup", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Research model", exact: true })
      .selectOption("test-model");
    await page
      .getByRole("textbox", { name: "Research brief", exact: true })
      .fill("Investigate my chart. No numeric data supplied.");
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    await expect(page.locator('[aria-label="Review direction"]')).toBeVisible({ timeout: 30000 });
    await page
      .getByRole("textbox", { name: "Reviewer feedback", exact: true })
      .fill("Test the opposing explanation.");
    await page.getByRole("button", { name: "Approve and continue", exact: true }).click();
    await expect(page.locator('[aria-label="Review review"]')).toBeVisible({ timeout: 30000 });
    const runId = new URL(page.url()).searchParams.get("run")!;
    const snapshot: RunSnapshot = await (await request.get(`/api/runs/${runId}`)).json();
    expect(snapshot.model_attempts).toHaveLength(3);
    expect(snapshot.model_attempts![1]!.result!.web_research!.sources[0]!.cited).toBe(true);
    const calculations = snapshot.events.find((event) => event.code)?.code;
    expect(JSON.parse(calculations!.outputs.text).analytics.status).toBe("needs_data");
    const researchAttempt = page.locator(".research-attempt").nth(1);
    await researchAttempt.locator("summary").first().click();
    const source = researchAttempt.getByRole("link", {
      name: "Synthetic observations",
      exact: true,
    });
    await expect(source).toHaveAttribute("href", "https://example.org/data");
    await expect(researchAttempt).toContainText("Cited by provider");
    await expect(
      researchAttempt
        .locator(".research-conclusion")
        .getByRole("link", { name: "Reference", exact: true }),
    ).toHaveAttribute("href", "https://example.org/data");
    await page.screenshot({ path: info.outputPath(`idea-research-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Approve and continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Run completed", exact: true })).toBeVisible({
      timeout: 30000,
    });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Run completed", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole("button", { name: "Iterate from this run", exact: true }).click();
    // The saved template remains editable without changing the historical run.
    const changed = structuredClone(snapshot.workflow);
    changed.nodes.find((n) => n.id === "research")!.config = {
      ...changed.nodes.find((n) => n.id === "research")!.config!,
      web_search: false,
    } as never;
    expect((await request.post("/api/workflows/validate", { data: changed })).ok()).toBe(true);
    expect(
      (await (await request.get(`/api/runs/${runId}`)).json()).workflow.nodes[2].config.web_search,
    ).toBe(true);
  });
}
