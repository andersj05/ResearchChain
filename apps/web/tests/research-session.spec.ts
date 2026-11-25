import { commissionDeskStudy, pinDeskNote } from "./desk-material";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReportCreate, ReportView, StyleGuide } from "../src/lib/reports";
import type { RunSnapshot } from "../src/lib/workflow";
import { expect, test } from "./fixtures";
import { styleBody } from "./report-fixture";

test("follow parallel research from a source packet through owner judgment to an illustrated report", async ({
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
  await pinDeskNote(page);
  await page.getByLabel("Context for the lead (optional)", { exact: true }).fill(brief);

  await page.getByLabel("Maximum research agents").selectOption("2");
  await page.getByLabel("Passes per agent").fill("3");
  const sharedModel = page.getByRole("combobox", { name: "Research model", exact: true });
  const shared = page.getByRole("group", { name: "Shared response settings", exact: true });
  const lead = page.getByRole("group", { name: "Research lead", exact: true });
  const researchers = page.getByRole("group", { name: "Researchers", exact: true });
  const writerControls = page.getByRole("group", { name: "Report editor", exact: true });
  const roleSettings = page.locator("summary").filter({ hasText: "Models by role" });
  const effort = shared.getByRole("slider", { name: "Thinking effort" });
  const detail = shared.getByRole("slider", { name: "Response detail" });
  await expect(sharedModel).toHaveValue("gpt-6.2-sol");
  await expect(effort).toHaveAttribute("aria-valuetext", "High");
  await expect(detail).toHaveAttribute("aria-valuetext", "High");
  await sharedModel.selectOption("test-model");
  await detail.press("Home");
  await expect(lead).toBeVisible();
  await expect(lead.getByLabel("Research lead model")).toHaveValue("gpt-6.2-astra");
  await expect(researchers.getByLabel("Researchers model")).toHaveValue("gpt-6.2-sol");
  const leadEffort = lead.getByRole("slider", { name: "Thinking effort" });
  await leadEffort.press("Home");
  await expect(leadEffort).toHaveAttribute("aria-valuetext", "Low");
  await lead
    .getByRole("group", { name: "Thinking effort control" })
    .getByRole("button", { name: "Use shared setting" })
    .click();
  await expect(leadEffort).toHaveAttribute("aria-valuetext", "Shared · High");
  await leadEffort.press("Home");
  await researchers.getByLabel("Researchers model").selectOption("analysis-model");
  const researcherEffort = researchers.getByRole("slider", { name: "Thinking effort" });
  const researcherDetail = researchers.getByRole("slider", { name: "Response detail" });
  await researcherEffort.press("End");
  await researchers
    .getByRole("group", { name: "Response detail control" })
    .getByRole("button", { name: "Use model default" })
    .click();
  await writerControls
    .getByRole("group", { name: "Thinking effort control" })
    .getByRole("button", { name: "Use model default" })
    .click();
  const writerDetail = writerControls.getByRole("slider", { name: "Response detail" });
  await writerDetail.press("End");
  await expect(page.getByLabel("Editorial review")).toHaveValue("when_needed");
  await page.getByRole("button", { name: "Ask the lead for a first reading", exact: true }).click();
  await expect(page).toHaveURL(/\?session=[\da-f-]{36}/);
  const sessionId = new URL(page.url()).searchParams.get("session")!;
  await commissionDeskStudy(page, "Compare demand and inventories over the same release window.");
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
    const briefSettings = page.getByText("Sources and settings", { exact: true });
    await briefSettings.click();
    const profiles = page.getByRole("table", { name: "Pinned model settings" });
    for (const [role, model, effort, detail] of [
      ["Research lead", "gpt-6.2-astra", "Low", "Low"],
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
    expect(live.research_manifest?.settings).toMatchObject({
      model: "test-model",
      reasoning_effort: "high",
      verbosity: "low",
    });
    const planner = live.model_attempts!.find((attempt) => attempt.path === "root/team/plan")!;
    const plannerBody = await (
      await request.get(`/api/artifacts/${encodeURIComponent(planner.input_artifact_id!)}/content`)
    ).json();
    expect(plannerBody).toMatchObject({
      model: "gpt-6.2-astra",
      reasoning: { effort: "low" },
      text: { verbosity: "low" },
    });
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
  await page.evaluate(() => scrollTo(0, 0));
  const revisit = page.getByRole("button", { name: "Revisit material", exact: true });
  await expect(revisit).toBeInViewport();
  await expect(page.getByRole("link", { name: "Read report", exact: true })).toBeInViewport();
  await revisit.click();
  await expect(page.getByLabel("Context for the lead (optional)", { exact: true })).toHaveValue(
    brief,
  );
  const researchSettings = page.locator("summary").filter({ hasText: "Research settings" });
  if (!(await shared.isVisible())) await researchSettings.click();
  await expect(effort).toHaveAttribute("aria-valuetext", "High");
  await expect(detail).toHaveAttribute("aria-valuetext", "Low");
  if (!(await researchers.isVisible())) await roleSettings.click();
  await expect(lead.getByLabel("Research lead model")).toHaveValue("gpt-6.2-astra");
  await expect(leadEffort).toHaveAttribute("aria-valuetext", "Low");
  await expect(researchers.getByLabel("Researchers model")).toHaveValue("analysis-model");
  await expect(researcherEffort).toHaveAttribute("aria-valuetext", "Extra high");
  await expect(researcherDetail).toHaveAttribute("aria-valuetext", "Model default");
  await expect(writerControls.getByRole("slider", { name: "Thinking effort" })).toHaveAttribute(
    "aria-valuetext",
    "Model default · Medium",
  );
  await expect(writerDetail).toHaveAttribute("aria-valuetext", "High");
  await expect(page.getByRole("link", { name: "previous study" })).toHaveAttribute(
    "href",
    `/?session=${sessionId}`,
  );
  await page.getByRole("link", { name: "previous study" }).click();
  await expect(page.getByRole("heading", { name: "Research report", exact: true })).toBeVisible();

  const style = await request.post("/api/style-guides", { data: styleBody(study) });
  expect(style.status()).toBe(201);
  const guide: StyleGuide = await style.json();
  await page.getByRole("link", { name: "Edit in Reports", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Draft this study report" })).toBeVisible();
  const create = page.getByRole("form", { name: "Create report" });
  const title = "Synthetic study editorial draft";
  await expect(create.getByRole("textbox", { name: "Report title" })).toHaveValue(
    brief.split("\n")[0]!,
  );
  await create.getByRole("textbox", { name: "Report title" }).fill(title);
  await create.getByRole("combobox", { name: "Pinned style guide" }).selectOption(guide.id);
  const submissions: ReportCreate[] = [];
  await page.route("**/api/reports", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    submissions.push(route.request().postDataJSON());
    if (submissions.length === 1) {
      expect((await route.fetch()).status()).toBe(201);
      return route.abort();
    }
    return route.continue();
  });
  const createButton = create.getByRole("button", { name: "Create report draft" });
  await createButton.click();
  await expect(create.getByRole("alert")).toBeVisible();
  await page.reload();
  await expect(create.getByRole("textbox", { name: "Report title" })).toHaveValue(title);
  await expect(create.getByRole("combobox", { name: "Pinned style guide" })).toHaveValue(guide.id);
  await createButton.click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[0]).toEqual(submissions[1]);
  expect(submissions[0]).toMatchObject({
    run_id: sessionId,
    attempt_id: final.model_attempts!.at(-1)!.id,
    source_format: "session_markdown",
  });
  await page.getByText("Preview the saved report", { exact: true }).click();
  const importedChart = page.getByRole("img", { name: "Comparison of synthetic measures" });
  await importedChart.scrollIntoViewIfNeeded();
  await expect
    .poll(() => importedChart.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(1);
  const section = page.getByRole("textbox", { name: "Section text", exact: true });
  const originalMarkdown = await section.inputValue();
  expect(originalMarkdown).toContain(`Owner direction: ${feedback}`);
  const editorialNote = "Retain the sample periods in the revised report.";
  await section.fill(`${originalMarkdown}\n\n${editorialNote}`);
  await page.getByRole("textbox", { name: "Revision change note" }).fill("Clarify study context.");
  await page.getByRole("button", { name: "Save report revision", exact: true }).click();
  await expect(page.getByText("Saved revision 2", { exact: true })).toBeVisible();
  const revisedId = new URL(page.url()).searchParams.get("report");
  const revised: ReportView = await (await request.get(`/api/reports/${revisedId}`)).json();
  expect(revised.revision.sections[0]!.body).toContain(editorialNote);
  expect(revised.revision.provenance.attempt.id).toBe(submissions[0]!.attempt_id);
  const unchanged: RunSnapshot = await (await request.get(runUrl)).json();
  expect(unchanged.model_attempts).toEqual(final.model_attempts);
});
