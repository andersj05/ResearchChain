import type { RunSnapshot } from "../src/lib/workflow";
import { expect, test } from "./fixtures";

test("commission a different investigation from a week of pinned material and inspect its request", async ({
  page,
  request,
}, info) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByText("Start from sources", { exact: true }).click();
  const start = page.getByRole("button", { name: "Ask the lead for a first reading" });
  await expect(start).toBeDisabled();

  await page.getByRole("button", { name: "Add chart" }).click();
  const chart = page.getByRole("form", { name: "Add chart" });
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 360;
    canvas.height = 100;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, 360, 100);
    ctx.fillStyle = "#253850";
    ctx.font = "14px sans-serif";
    ctx.fillText("Synthetic weekly index", 12, 18);
    ctx.beginPath();
    ctx.moveTo(12, 78);
    ctx.lineTo(110, 68);
    ctx.lineTo(204, 74);
    ctx.lineTo(340, 34);
    ctx.stroke();
    return canvas.toDataURL().split(",")[1]!;
  });
  await chart.getByLabel("Chart file").setInputFiles({
    name: "Weekly index.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await chart.getByLabel("Usage rights").selectOption("owned");
  await chart.getByRole("button", { name: "Pin chart" }).click();
  const packet = page.getByRole("list", { name: "Pinned material" });
  await expect(packet).toContainText("Weekly index.png");
  await page.getByRole("button", { name: "Add note" }).click();
  const note = page.getByRole("form", { name: "Add note" });
  await note.getByLabel("Source title").fill("Monday expectations");
  await note
    .getByLabel("Note text")
    .fill("I expected the stocks with near-term maturities to respond first.");
  await note.getByLabel("Usage rights").selectOption("owned");
  await note.getByRole("button", { name: "Pin note" }).click();
  await expect(packet).toContainText("Monday expectations");
  await page.getByRole("button", { name: "Add conversation" }).click();
  const conversation = page.getByRole("form", { name: "Add conversation" });
  await conversation.getByLabel("Source title").fill("Friday desk call");
  await conversation
    .getByLabel("Conversation excerpt")
    .fill("At our desk, the median member was flat.");
  await conversation.getByLabel("Speaker or desk").fill("Synthetic sector desk");
  await conversation.getByLabel("As of").fill("2026-11-20");
  await conversation.getByLabel("Usage rights").selectOption("permission");
  await conversation.getByRole("button", { name: "Pin conversation" }).click();
  await expect(packet).toContainText("Synthetic sector desk");
  await page.reload();
  await expect(packet.getByRole("listitem")).toHaveCount(3);
  await expect(page.getByLabel("Context for the lead (optional)")).toBeEmpty();
  await start.click();
  await expect(page).toHaveURL(/\?session=[\da-f-]{36}/);
  const session = new URL(page.url()).searchParams.get("session")!;
  const sheet = page.getByRole("region", { name: "Source-led investigation" });
  const assign = sheet.getByRole("button", { name: "Assign research" });
  await expect(assign).toBeVisible({ timeout: 45_000 });
  await expect(assign).toBeDisabled();
  await expect(
    sheet.getByText("At our desk, the median member was flat.", { exact: true }),
  ).toBeVisible();
  await expect(sheet.getByRole("img", { name: "Weekly index.png" })).toBeVisible();
  const paused: RunSnapshot = await (await request.get(`/api/runs/${session}`)).json();
  expect(paused.model_attempts?.map((pass) => pass.path)).toEqual(["root/discovery"]);
  await sheet.screenshot({ path: info.outputPath("first-reading.png") });
  const sentence = sheet.getByLabel("Your working sentence");
  await sheet.getByRole("button", { name: "Use this sentence" }).click();
  await expect(sentence).toHaveValue(/larger constituents/);
  await expect(sentence).toBeFocused();
  const judgment = "The rally favored firms with debt due next year within the same sector.";
  await sentence.fill(judgment);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(sentence).toHaveValue(judgment);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await sheet.screenshot({ path: info.outputPath("mobile-decision.png") });
  await assign.click();
  const assignments = sheet.getByRole("region", { name: "Issued assignments" });
  await expect(
    assignments.getByRole("heading", { name: "Compare refinancing groups" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(sheet.getByText(judgment, { exact: true })).toBeVisible();
  await expect(assignments).toContainText("Compare weekly returns within each sector.");
  await assignments.getByRole("link", { name: "Inspect researcher request" }).click();
  await expect(page).toHaveURL(/workspace=agent-1&pass=/);
  const workspace = page.getByRole("region", { name: "Compare refinancing groups workspace" });
  const saved = await workspace.getByRole("link", { name: "Saved request" }).getAttribute("href");
  const receipt = await (await request.get(saved!)).json();
  const input = JSON.parse(receipt.input[0].content[0].text);
  expect(input.human_feedback).toBe(judgment);
  expect(input.prior_result.discovery.proposals[0].first_check).toContain("equal-weight");
  await sheet.screenshot({ path: info.outputPath("issued-assignment.png") });
  await page.getByRole("button", { name: "Revisit material" }).click();
  await expect(packet.getByRole("listitem")).toHaveCount(3);
  await expect(page.getByLabel("Context for the lead (optional)")).toBeEmpty();
  await start.click();
  await expect(sheet.getByRole("button", { name: "Park this study" })).toBeVisible({
    timeout: 45_000,
  });
  await sheet.getByRole("button", { name: "Park this study" }).click();
  await expect(sheet.getByRole("heading", { name: "Study parked" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByLabel("Run status")).toHaveText("Parked");
  await expect(sheet.getByRole("region", { name: "Issued assignments" })).toHaveCount(0);
});
