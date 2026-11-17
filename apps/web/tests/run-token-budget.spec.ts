import { expect, test } from "./fixtures";
import { runRequest } from "./run-fixture";
import research from "../../../examples/hypothesis-research.json";
import type { RunSnapshot } from "../src/lib/workflow";

test("iterate from a saved fixed budget and pin an as-needed budget to the new run", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const workflow = structuredClone(research);
  workflow.research.model = "test-model";
  workflow.research.limits.max_total_tokens = 60_000;
  const revision = await (await request.post("/api/revisions", { data: workflow })).json();
  const response = await runRequest(request, "/api/runs", {
    data: {
      id: crypto.randomUUID(),
      revision_id: revision.id,
      brief: "Explore this synthetic budget fixture.",
      provider_account_id: "oaiapp_fixture",
    },
  });
  const original: RunSnapshot = await response.json();
  expect(original.status).toBe("paused");

  await page.goto(`/?run=${original.id}`);
  await page.getByRole("button", { name: "Iterate from this run", exact: true }).click();
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Start a research run" });
  const total = dialog.getByRole("spinbutton", { name: "Total tokens per run" });
  await expect(total).toHaveValue("60000");
  await dialog.getByRole("button", { name: "Use 1,000,000 tokens" }).click();
  await expect(total).toHaveValue("1000000");
  await dialog.getByRole("combobox", { name: "Token budget" }).selectOption("as_needed");
  await expect(total).toHaveCount(0);
  await dialog.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Run paused", exact: true })).toBeVisible({
    timeout: 30000,
  });
  const nextId = new URL(page.url()).searchParams.get("run");
  expect(nextId).not.toBe(original.id);
  const next: RunSnapshot = await (await request.get(`/api/runs/${nextId}`)).json();
  expect(next.brief).toBe(original.brief);
  expect(next.research_manifest?.settings.limits?.max_total_tokens).toBe("as_needed");
  const previous: RunSnapshot = await (await request.get(`/api/runs/${original.id}`)).json();
  expect(previous.research_manifest?.settings.limits?.max_total_tokens).toBe(60_000);
});
