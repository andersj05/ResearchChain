import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { contentUrl, type EvidenceRecord } from "../src/lib/evidence";
import type { RunSnapshot } from "../src/lib/workflow";

test("attach a chart and carry the frozen design and owner's verdict through the signal workflow", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  const create = page.getByRole("dialog", { name: "Create an agent" });
  await create.getByLabel("Starting workflow").selectOption({ label: "Chart signal research" });
  await expect(create.getByLabel("Agent name")).toHaveValue("Chart signal research");
  await create.getByRole("button", { name: "Create agent", exact: true }).click();
  await expect(create).toBeHidden();
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Start a research run" });
  const brief = "Synthetic chart. Does weekly X predict next week's Y?";
  const briefField = setup.getByLabel("Research brief", { exact: true });
  await expect(briefField).toHaveValue(/My proposed explanation/);
  await briefField.fill(brief);
  await setup
    .getByRole("combobox", { name: "Research model", exact: true })
    .selectOption("test-model");
  const upload = setup.getByRole("button", { name: "Upload a chart" });
  await upload.click();
  await setup.getByRole("button", { name: "Cancel source" }).click();
  await expect(upload).toBeFocused();
  await expect(briefField).toHaveValue(brief);
  await upload.click();
  const title = `synthetic-${randomUUID()}.png`;
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=";
  await setup
    .getByLabel("Original file")
    .setInputFiles({ name: title, mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(setup.getByLabel("Source title")).toHaveValue(title);
  await expect(setup.getByLabel("Representation", { exact: true })).toHaveValue("chart_screenshot");
  await setup.getByLabel("Access rights").selectOption("owned");
  const save = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/evidence") && response.request().method() === "POST",
  );
  await setup.getByRole("button", { name: "Save and attach" }).click();
  const response = await save;
  expect(response.status(), await response.text()).toBe(201);
  const source: EvidenceRecord = await response.json();
  await expect(setup.getByRole("checkbox", { name: `${title} Captured` })).toBeChecked();
  await expect(briefField).toHaveValue(brief);
  await setup.getByRole("button", { name: "Start run", exact: true }).click();
  const design = page.getByLabel("Review design", { exact: true });
  await expect(design).toBeVisible({ timeout: 30_000 });
  const protocol =
    "Freeze a one-week horizon, a 2020-01-09T00:00:00Z cutoff and training-mean RMSE.";
  await design.getByLabel("Reviewer feedback").fill(protocol);
  await design.getByRole("button", { name: "Approve and continue" }).click();
  const verdict = page.getByLabel("Review verdict", { exact: true });
  await expect(verdict).toBeVisible({ timeout: 30_000 });
  const judgment = "Reserve judgment until we have unseen observations.";
  await verdict.getByLabel("Reviewer feedback").fill(judgment);
  await verdict.getByRole("button", { name: "Approve and continue" }).click();
  await expect(page.getByRole("status", { name: "Run status", exact: true })).toHaveText(
    "Completed",
    { timeout: 30_000 },
  );
  const runId = new URL(page.url()).searchParams.get("run");
  const run: RunSnapshot = await (await request.get(`/api/runs/${runId}`)).json();
  expect(run.research_manifest?.evidence[0]).toMatchObject({
    evidence_id: source.id,
    original: source.content_hash,
    representation: "chart_screenshot",
  });
  const attempts = run.model_attempts!;
  expect(attempts.map((attempt) => attempt.path).sort()).toEqual([
    "root/challenge",
    "root/forecast",
    "root/frame",
    "root/memo",
    "root/panel",
    "root/sources",
  ]);
  for (const attempt of attempts) {
    const payload = await (await request.get(contentUrl(attempt.input_artifact_id!))).json();
    const content = payload.input.find(
      (item: { content?: { type: string }[] }) =>
        Array.isArray(item.content) && item.content.some((part) => part.type === "input_image"),
    ).content;
    expect(content).toContainEqual({
      type: "input_image",
      image_url: `data:image/png;base64,${png}`,
      detail: "auto",
    });
    const packet = JSON.parse(content[0].text);
    expect(packet.brief).toBe(brief);
    if (["root/panel", "root/forecast", "root/challenge"].includes(attempt.path))
      expect(packet.human_feedback).toBe(protocol);
    if (attempt.path === "root/memo") expect(packet.human_feedback).toBe(judgment);
    if (["root/sources", "root/challenge"].includes(attempt.path))
      expect(attempt.result?.web_research?.sources[0]?.url).toBe("https://example.org/data");
  }
});
