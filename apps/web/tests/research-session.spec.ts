import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunSnapshot } from "../src/lib/workflow";
import { expect, test } from "./fixtures";

test("follow parallel research from a brief through owner judgment to an illustrated report", async ({
  page,
  request,
}, info) => {
  test.setTimeout(180_000);
  const directory = process.env.RESEARCHCHAIN_ACCESS_DIRECTORY;
  if (!directory) throw new Error("Run the isolated browser-test runner.");
  const study = crypto.randomUUID();
  const brief = `Compare synthetic demand and inventories and illustrate the result.\nBrowser study ${study}`;
  const guidance = "Check both series for a common release cutoff before comparing them.";
  const feedback = "Use quarterly order volume and show both series as synthetic units.";
  const marker = join(directory, `observed-${study}`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByLabel("Research brief", { exact: true }).fill(brief);
  await page.locator("summary").filter({ hasText: "Research settings" }).click();
  await page.getByLabel("Maximum research agents").selectOption("2");
  await page.getByLabel("Passes per agent").fill("3");
  await page
    .getByRole("combobox", { name: "Research model", exact: true })
    .selectOption("test-model");
  const shared = page.getByRole("group", { name: "Shared response settings", exact: true });
  const lead = page.getByRole("group", { name: "Research lead", exact: true });
  const researchers = page.getByRole("group", { name: "Researchers", exact: true });
  const writerControls = page.getByRole("group", { name: "Report editor", exact: true });
  const roleSettings = page.locator("summary").filter({ hasText: "Models by role" });
  await shared.getByLabel("Thinking effort").selectOption("high");
  await shared.getByLabel("Response detail").selectOption("low");
  await roleSettings.click();
  await lead.getByLabel("Thinking effort").selectOption("low");
  await researchers.getByLabel("Researchers model").selectOption("analysis-model");
  await researchers.getByLabel("Thinking effort").selectOption("xhigh");
  await researchers.getByLabel("Response detail").selectOption("model_default");
  await writerControls.getByLabel("Thinking effort").selectOption("model_default");
  await writerControls.getByLabel("Response detail").selectOption("high");
  await expect(page.getByLabel("Expert review")).toHaveValue("when_needed");
  await page.getByRole("button", { name: "Start research", exact: true }).click();
  await expect(page).toHaveURL(/\?session=[\da-f-]{36}/);
  const sessionId = new URL(page.url()).searchParams.get("session")!;
  const runUrl = `/api/runs/${sessionId}`;
  const roster = page.getByRole("navigation", { name: "Agent workspaces" });
  const demand = roster.getByRole("button", { name: /^Demand/ });
  const inventories = roster.getByRole("button", { name: /^Inventories/ });
  const inventory = page.getByRole("region", { name: "Inventories workspace" });
  try {
    await expect(demand).toContainText("Requesting", { timeout: 80_000 });
    await expect(inventories).toContainText("Requesting");
    await inventories.click();
    await expect(inventory).toContainText("Model request in progress");
    await expect(page).toHaveURL(/workspace=agent-2/);
    await page.reload();
    await expect(inventories).toHaveAttribute("aria-current", "true");
    await expect(inventory).toContainText("Pass 1 · analysis-model");
    const briefSettings = page.getByText("Brief and settings", { exact: true });
    await briefSettings.click();
    const profiles = page.getByRole("table", { name: "Pinned model settings" });
    for (const [role, model, effort, detail] of [
      ["Research lead", "test-model", "Low", "Low"],
      ["Researchers", "analysis-model", "Extra high", "Model default"],
      ["Report editor", "test-model", "Model default", "High"],
    ] as const) {
      const row = profiles
        .getByRole("row")
        .filter({ has: page.getByRole("rowheader", { name: role, exact: true }) });
      await expect(row.getByRole("cell")).toHaveText([model, effort, detail]);
    }
    await briefSettings.click();
    await expect(demand).toContainText("Requesting");
    const live: RunSnapshot = await (await request.get(runUrl)).json();
    expect(
      live.model_attempts
        ?.filter((attempt) => attempt.status === "requesting")
        .map((a) => a.path)
        .sort(),
    ).toEqual(["root/team/agent-1", "root/team/agent-2"]);
    await page.getByText("Guide the team", { exact: true }).click();
    await page.getByLabel("Direction for upcoming passes").fill(guidance);
    await page.getByRole("button", { name: "Send direction" }).click();
    await expect(page.getByText("Saved for upcoming passes", { exact: false })).toBeVisible();
    await expect(page.getByText(guidance, { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("active-researchers.png"), fullPage: true });
  } finally {
    await writeFile(marker, "The browser observed both requests.");
  }

  const judgment = page.getByRole("region", { name: "Your judgment" });
  await expect(judgment).toContainText("Which demand measure fits your mandate?", {
    timeout: 60_000,
  });
  await expect(inventory).toContainText("Saved findings for Inventories.");
  await inventory.getByLabel("Preview workspace file").selectOption("series.csv");
  await expect(inventory.getByRole("cell", { name: "Inventories", exact: true })).toBeVisible();
  await expect(inventory.getByRole("cell", { name: "7", exact: true })).toBeVisible();
  const passSummary = inventory.getByText("Model passes (2)", { exact: true });
  await passSummary.click();
  const paused: RunSnapshot = await (await request.get(runUrl)).json();
  const firstId = paused.model_attempts!.find((a) => a.path === "root/team/agent-2")!.id;
  const secondId = paused.model_attempts!.find(
    (a) => a.path === "root/team/agent-2/analyst-pass-2",
  )!.id;
  const selector = inventory.getByRole("combobox", { name: "Inspect model pass" });
  const savedRequest = inventory.getByRole("link", { name: "Saved request", exact: true });
  await selector.selectOption(firstId);
  await expect(selector).toHaveValue(firstId);
  const passOne = await (await request.get((await savedRequest.getAttribute("href"))!)).json();
  await selector.selectOption(secondId);
  await expect(page).toHaveURL(new RegExp(`pass=${secondId}`));
  await page.reload();
  await expect(selector).toHaveValue(secondId);
  const passTwo = await (await request.get((await savedRequest.getAttribute("href"))!)).json();
  for (const pass of [passOne, passTwo]) {
    expect(pass).toMatchObject({
      model: "analysis-model",
      reasoning: { effort: "xhigh" },
      text: { format: { strict: true } },
    });
    expect(pass.text.verbosity).toBeUndefined();
  }
  await expect(inventory).toContainText(
    "Thinking effort · Extra high · Response detail · Model default",
  );
  expect(passOne.input).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ type: "function_call_output" })]),
  );
  expect(passTwo.input).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "function_call_output",
        output: expect.stringContaining("series.csv"),
      }),
    ]),
  );
  const earlierPacket = JSON.parse(passOne.input[0].content[0].text);
  const laterPacket = JSON.parse(passTwo.input[0].content[0].text);
  expect(earlierPacket.owner_directions).toBeUndefined();
  expect(laterPacket.owner_directions).toEqual([
    { id: expect.any(String), text: guidance, created_at: expect.any(String) },
  ]);
  const [note] = laterPacket.owner_directions;
  for (const lane of ["root/team/agent-1", "root/team/agent-2"]) {
    const passes = paused.model_attempts!;
    expect(passes.find((a) => a.path === lane)).not.toHaveProperty("owner_direction_ids");
    expect(passes.find((a) => a.path === `${lane}/analyst-pass-2`)).toMatchObject({
      owner_direction_ids: [note.id],
    });
  }
  await demand.click();
  const demandWorkspace = page.getByRole("region", { name: "Demand workspace" });
  await demandWorkspace.getByLabel("Preview workspace file").selectOption("series.csv");
  await expect(demandWorkspace.getByRole("cell", { name: "Demand", exact: true })).toBeVisible();
  await expect(demandWorkspace.getByRole("cell", { name: "2", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await judgment.getByLabel("Direction for the editor").fill(feedback);
  await page.reload();
  await expect(judgment.getByLabel("Direction for the editor")).toHaveValue(feedback);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await judgment.getByRole("button", { name: "Continue to report" }).click();
  await roster.getByRole("button", { name: /^Report editor/ }).click();
  const editor = page.getByRole("region", { name: "Report editor workspace" });
  await expect(page.getByRole("status", { name: "Run status" })).toHaveText("Completed", {
    timeout: 60_000,
  });
  await expect(
    editor.getByRole("heading", { name: "Synthetic measures", exact: true }),
  ).toBeVisible();
  await expect(editor).toContainText("Demand: 2");
  await expect(editor).toContainText("Inventories: 7");
  await expect(editor).toContainText(`Team direction: ${guidance}`);
  await expect(editor).toContainText(`Owner direction: ${feedback}`);
  const chart = editor.getByRole("img", { name: "Comparison of synthetic measures", exact: true });
  await expect
    .poll(() => chart.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(1);
  const final: RunSnapshot = await (await request.get(runUrl)).json();
  const writer = final.model_attempts!.find((attempt) => attempt.path === "root/report")!;
  const editorRequest = await (
    await request.get(`/api/artifacts/${encodeURIComponent(writer.input_artifact_id!)}/content`)
  ).json();
  expect(editorRequest).toMatchObject({ model: "test-model", text: { verbosity: "high" } });
  expect(editorRequest.reasoning?.effort).toBeUndefined();
  expect(JSON.parse(editorRequest.input[0].content[0].text)).toMatchObject({
    human_feedback: feedback,
    owner_directions: [note],
  });
  expect(writer).toMatchObject({ owner_direction_ids: [note.id] });
  const download = page.waitForEvent("download");
  await editor.getByRole("link", { name: "Download report and files" }).click();
  const bundle = await download;
  expect(bundle.suggestedFilename()).toBe(`research-${sessionId}.zip`);
  expect(await bundle.failure()).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("illustrated-report-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Revise brief" }).click();
  await expect(page.getByLabel("Research brief", { exact: true })).toHaveValue(brief);
  const researchSettings = page.locator("summary").filter({ hasText: "Research settings" });
  if (!(await shared.isVisible())) await researchSettings.click();
  await expect(shared.getByLabel("Thinking effort")).toHaveValue("high");
  await expect(shared.getByLabel("Response detail")).toHaveValue("low");
  if (!(await researchers.isVisible())) await roleSettings.click();
  await expect(lead.getByLabel("Thinking effort")).toHaveValue("low");
  await expect(researchers.getByLabel("Researchers model")).toHaveValue("analysis-model");
  await expect(researchers.getByLabel("Thinking effort")).toHaveValue("xhigh");
  await expect(researchers.getByLabel("Response detail")).toHaveValue("model_default");
  await expect(writerControls.getByLabel("Thinking effort")).toHaveValue("model_default");
  await expect(writerControls.getByLabel("Response detail")).toHaveValue("high");
  await expect(page.getByRole("link", { name: "previous study" })).toHaveAttribute(
    "href",
    `/?session=${sessionId}`,
  );
  await page.getByRole("link", { name: "previous study" }).click();
  await expect(page.getByRole("heading", { name: "Research report", exact: true })).toBeVisible();
});
