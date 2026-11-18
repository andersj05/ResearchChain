import { expect, test } from "./fixtures";
import type { RunSnapshot } from "../src/lib/workflow";
import workflow from "../../../examples/idea-research.json";

for (const width of [1440, 390]) {
  test(`idea example retains web settings and sources through reviews at ${width}px`, async ({
    page,
    request,
  }, info) => {
    test.setTimeout(90000);
    const externalRequests: string[] = [];
    page.on("request", (request) => {
      if (
        request.url().includes("unrecorded.invalid") ||
        request.url() === "https://example.org/data"
      )
        externalRequests.push(request.url());
    });
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
    const sec = page.getByRole("checkbox", { name: "SEC financial statements", exact: true });
    await expect(webToggle).toHaveValue("auto");
    await expect(sec).toBeChecked();
    const analyst = page.getByRole("checkbox", { name: "Codex analyst", exact: true });
    await expect(analyst).not.toBeChecked();
    await analyst.check();
    await page
      .getByRole("textbox", { name: "Analyst skill" })
      .fill("Compare dated primary sources.");
    await page.getByRole("spinbutton", { name: "Maximum research passes" }).fill("3");
    await webToggle.selectOption("true");
    await page
      .getByRole("combobox", { name: "Step behavior", exact: true })
      .selectOption("hypothesize");
    await expect(webToggle).toBeHidden();
    await page.getByRole("combobox", { name: "Step behavior", exact: true }).selectOption("custom");
    await expect(webToggle).toHaveValue("false");
    await expect(sec).not.toBeChecked();
    await expect(analyst).not.toBeChecked();
    await page.getByRole("button", { name: "Use idea research example", exact: true }).click();
    await page.getByRole("button", { name: "Validate workflow", exact: true }).click();
    await expect(page.getByRole("status", { name: "Workspace status" })).toHaveText(
      "Workflow valid. Ready to run.",
    );
    await page.getByRole("button", { name: "Run workflow", exact: true }).click();
    await page.getByText("External research tools · 2 steps", { exact: true }).click();
    await expect(page.getByText("Codex analyst, up to 4 passes", { exact: false })).toBeVisible();
    await expect(
      page.getByText("optional web search, optional SEC lookup", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("required web search, optional SEC lookup", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Research model", exact: true })
      .selectOption("test-model");
    await page
      .getByRole("textbox", { name: "Research brief", exact: true })
      .fill("Inspect Markdown output. No numeric data supplied.");
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    await expect(page.locator('[aria-label="Review direction"]')).toBeVisible({ timeout: 30000 });
    await page
      .getByRole("textbox", { name: "Reviewer feedback", exact: true })
      .fill("Test the opposing explanation.");
    await page.getByRole("button", { name: "Approve and continue", exact: true }).click();
    await expect(page.locator('[aria-label="Review review"]')).toBeVisible({ timeout: 30000 });
    const runId = new URL(page.url()).searchParams.get("run")!;
    const snapshot: RunSnapshot = await (await request.get(`/api/runs/${runId}`)).json();
    const attempts = snapshot.model_attempts!;
    expect(attempts.at(-1)?.path).toBe("root/memo");
    expect(attempts.filter((a) => a.path.startsWith("root/research")).map((a) => a.path)).toEqual([
      "root/research",
      "root/research/analyst-pass-2",
    ]);
    for (const path of ["root/frame", "root/research"]) {
      expect(attempts.find((a) => a.path === path)?.result?.web_research?.sources[0]?.cited).toBe(
        true,
      );
    }
    const calculations = snapshot.events.find((event) => event.code)?.code;
    expect(JSON.parse(calculations!.outputs.text).analytics.status).toBe("needs_data");
    const choose = page.getByRole("combobox", { name: "Inspect step" });
    await expect(choose).toHaveValue("root/review");
    await page.screenshot({ path: info.outputPath(`idea-checkpoint-${width}.png`) });
    const graph = page.getByRole("region", { name: "Run workflow graph" });
    await graph.getByRole("button", { name: "Fit run graph to view" }).click();
    await graph
      .getByRole("button", { name: "Inspect Choose research direction", exact: true })
      .click();
    await expect(page.getByRole("region", { name: "Selected step" })).toContainText(
      "Test the opposing explanation.",
    );
    await choose.selectOption("root/research");
    const researchAttempt = page.locator(".research-attempt[open]");
    await expect(researchAttempt).toHaveCount(1);
    await expect(researchAttempt.locator("summary").first()).toContainText(
      "Research support and objections",
    );
    const memo = researchAttempt.locator(".research-conclusion");
    await expect(memo.getByRole("heading", { name: "Research memo" })).toBeVisible();
    await expect(memo.locator("strong")).toHaveText("Observations");
    await expect(memo.getByRole("listitem")).toHaveCount(2);
    await expect(memo.getByRole("cell", { name: "17", exact: true })).toBeVisible();
    await expect(memo.locator("blockquote")).toContainText("Keep dates attached");
    await expect(memo.locator("pre code")).toContainText("period,quantity");
    await expect(memo.getByRole("link", { name: "unrecorded source" })).toHaveCount(0);
    await expect(memo).toContainText("External chart");
    await expect(memo.locator("img, button")).toHaveCount(0);
    expect(externalRequests).toEqual([]);
    await expect(
      researchAttempt.getByText("Provider-reported references", { exact: false }),
    ).toBeHidden();
    await researchAttempt.locator("summary").filter({ hasText: "Web sources" }).press("Enter");
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
    const openSource = researchAttempt.getByRole("button", {
      name: "Save source link for Synthetic observations",
    });
    const sourceDialog = page.getByRole("dialog", { name: "Save a source link" });
    const referenceTitle = `Saved synthetic reference ${width}`;
    await openSource.press("Enter");
    await expect(sourceDialog.getByLabel("Source title")).toHaveValue("Synthetic observations");
    await expect(sourceDialog.getByLabel("Source title")).toBeFocused();
    await sourceDialog.getByLabel("Source title").fill(referenceTitle);
    await sourceDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(openSource).toBeFocused();
    await openSource.click();
    const saveSource = sourceDialog.getByRole("button", { name: "Save source", exact: true });
    let savedBeforeResponse: string | undefined;
    if (width === 390) {
      await page.route("**/api/evidence", async (route) => {
        if (route.request().method() !== "POST" || savedBeforeResponse) {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        savedBeforeResponse = (await response.json()).id;
        await route.fulfill({ status: 503, json: { detail: "Temporarily unavailable" } });
      });
    }
    await saveSource.click();
    if (width === 390) {
      await expect(sourceDialog.getByRole("alert")).toContainText("Temporarily unavailable");
      await saveSource.click();
    }
    const savedSource = researchAttempt.getByRole("link", { name: "View saved source" });
    await expect(savedSource).toBeFocused();
    await expect(sourceDialog).toBeHidden();
    const href = (await savedSource.getAttribute("href"))!;
    const sourceId = new URL(href, page.url()).searchParams.get("evidence");
    if (width === 390) {
      expect(sourceId).toBe(savedBeforeResponse);
      await page.unroute("**/api/evidence");
    }
    const saved = await (await request.get(`/api/evidence/${sourceId}`)).json();
    expect(saved).toMatchObject({
      title: referenceTitle,
      kind: "link",
      availability: "reference_only",
      source_url: "https://example.org/data",
      retrieved_at: null,
    });
    const sourceAttempt = snapshot.model_attempts!.find(
      (attempt) => attempt.path === "root/research/analyst-pass-2",
    )!;
    expect(saved.notes).toContain(`Run ${runId}, attempt ${sourceAttempt.id}.`);
    expect(externalRequests).toEqual([]);
    await page.getByRole("button", { name: "Return to review", exact: true }).click();
    await page.getByRole("button", { name: "Approve and continue", exact: true }).click();
    await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Completed", {
      timeout: 30000,
    });
    await page.reload();
    await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Completed");
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
