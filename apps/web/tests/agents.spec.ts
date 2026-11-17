import { expect, test, type Page } from "./fixtures";
import example from "../../../examples/research-workflow.json";

async function createAgent(page: Page, name: string) {
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  await page.getByRole("textbox", { name: "Agent name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Create agent", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Create an agent", exact: true })).toBeHidden();
  await expect(page.getByRole("combobox", { name: "Agent", exact: true })).toHaveValue(/.+/);
  return page.getByRole("combobox", { name: "Agent", exact: true }).inputValue();
}
for (const width of [1440, 390]) {
  test(`named agents preserve drafts, inputs and exact run ownership at ${width}px`, async ({
    page,
    request,
  }, info) => {
    test.setTimeout(60000);
    const revision = await (await request.post("/api/revisions", { data: example })).json();
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/?revision=${revision.id}`);
    await expect(page.getByRole("button", { name: "New agent", exact: true })).toBeEnabled();
    const selector = page.getByRole("combobox", { name: "Agent", exact: true });
    const alpha = await createAgent(page, `Alpha ${width}`);
    await page.getByRole("button", { name: "Add research note", exact: true }).click();
    const instructions = page.getByRole("textbox", { name: "Instructions", exact: true });
    await instructions.fill("My saved Alpha note");
    await page.getByRole("button", { name: "Save revision", exact: true }).click();
    await expect(page.getByRole("status", { name: "Workspace status" })).toContainText("saved");
    await page.getByRole("button", { name: "Run workflow", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Research brief", exact: true })
      .fill("Alpha input stays with Alpha");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await instructions.fill("My unsaved Alpha note");
    const beta = await createAgent(page, `Beta ${width}`);
    await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(
      "Finish",
    );
    await selector.selectOption(alpha);
    await expect(instructions).toHaveValue("My unsaved Alpha note");
    await page.reload();
    await expect(selector).toHaveValue(alpha);
    await expect(instructions).toHaveValue("My unsaved Alpha note");
    await page.getByRole("button", { name: "Run workflow", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Research brief", exact: true })).toHaveValue(
      "Alpha input stays with Alpha",
    );
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Completed", {
      timeout: 30000,
    });
    await expect(page.getByLabel("Run agent", { exact: true })).toHaveText(`Alpha ${width}`);
    const runId = new URL(page.url()).searchParams.get("run")!;
    expect((await (await request.get(`/api/runs/${runId}`)).json()).agent_id).toBe(alpha);
    await selector.selectOption(beta);
    await page.getByRole("tab", { name: "Runs", exact: true }).click();
    expect(await (await request.get(`/api/runs?agent_id=${beta}`)).json()).toEqual([]);
    await expect(page.locator(".run-history .run-row")).toHaveCount(0);
    await selector.selectOption(alpha);
    await page.getByRole("tab", { name: "Versions", exact: true }).click();
    await expect(page.getByRole("region", { name: "Saved revisions" })).toContainText(
      `Alpha ${width}`,
    );
    await page.getByRole("tab", { name: "Build", exact: true }).click();
    await page.screenshot({
      path: info.outputPath(`agent-workspace-${width}.png`),
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await instructions.fill("Alpha draft before opening an older run");
    await selector.selectOption("");
    await page.getByRole("tab", { name: "Runs", exact: true }).click();
    await page
      .locator(".run-row")
      .filter({ hasText: `Alpha ${width}` })
      .first()
      .click();
    await page.getByRole("button", { name: "Iterate from this run", exact: true }).click();
    await expect(selector).toHaveValue(alpha);
    await expect(instructions).toHaveValue("My unsaved Alpha note");
    await page.getByRole("tab", { name: "Versions", exact: true }).click();
    await expect(page.getByRole("region", { name: "Saved revisions" })).toContainText("Version 3");
    await page.getByRole("tab", { name: "Build", exact: true }).click();
    await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
    await expect(instructions).toHaveValue("Alpha draft before opening an older run");
    expect((await (await request.get(`/api/runs/${runId}`)).json()).agent_id).toBe(alpha);
    expect(await (await request.get(`/api/revisions/${revision.id}`)).json()).toEqual(revision);
  });
}

test("a stale agent draft cannot overwrite a newer tab and can load the latest version", async ({
  page,
  request,
}) => {
  const agent = await (
    await request.post("/api/agents", {
      data: { id: crypto.randomUUID(), workflow: { ...example, name: "Concurrent owner edit" } },
    })
  ).json();
  await page.goto(`/?agent=${agent.agent.id}`);
  const instructions = page.getByRole("textbox", { name: "Instructions", exact: true });
  await expect(instructions).toHaveValue(example.nodes[0]!.instructions);
  await instructions.fill("This tab's draft");
  const newer = structuredClone(agent.revision.workflow);
  newer.nodes[0].instructions = "Newer saved version from another tab";
  expect(
    (
      await request.post(`/api/agents/${agent.agent.id}/revisions`, {
        data: { expected_version: 1, workflow: newer },
      })
    ).status(),
  ).toBe(201);
  await page.getByRole("button", { name: "Save revision", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("changed in another tab");
  await expect(instructions).toHaveValue("This tab's draft");
  await page.getByRole("button", { name: "Load latest", exact: true }).click();
  await expect(instructions).toHaveValue("Newer saved version from another tab");
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  await expect(instructions).toHaveValue("This tab's draft");
});
