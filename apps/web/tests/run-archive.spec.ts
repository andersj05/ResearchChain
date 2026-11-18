import { expect, test } from "./fixtures";
import type { AgentDetail, RunSnapshot, RunSummary, Workflow } from "../src/lib/workflow";
import legacy from "../../../examples/research-workflow.json";

test("find and compare an older experiment outside recent runs", async ({ page, request }) => {
  test.setTimeout(90000);
  const workflow = {
    ...legacy,
    name: "Archived rates experiment",
    nodes: legacy.nodes.filter((node) => ["frame", "finish"].includes(node.id)),
    edges: [{ source: "frame", target: "finish" }],
  } as Workflow;
  async function makeAgent(): Promise<AgentDetail> {
    const created = await request.post("/api/agents", {
      data: { id: crypto.randomUUID(), workflow },
    });
    expect(created.status()).toBe(201);
    return created.json();
  }
  async function start(agent: AgentDetail, brief: string) {
    const id = crypto.randomUUID();
    const response = await request.post("/api/runs", {
      data: { id, brief, agent_id: agent.agent.id, revision_id: agent.revision.id },
    });
    expect(response.status()).toBe(202);
    return id;
  }
  const agent = await makeAgent();
  const another = await makeAgent();
  const olderBrief = "Use the original synthetic breakevens baseline.";
  const older = await start(agent, olderBrief);
  const foreign = await start(another, olderBrief);
  await expect
    .poll(async () => {
      const snapshot: RunSnapshot = await (await request.get(`/api/runs/${older}`)).json();
      return snapshot.status;
    })
    .toBe("completed");
  for (let index = 0; index < 20; index++) {
    await start(agent, `Other synthetic rates scenario ${index + 1}.`);
  }
  const active = await start(agent, "Review a new duration scenario.");
  const recent: RunSummary[] = await (
    await request.get(`/api/runs?agent_id=${agent.agent.id}`)
  ).json();
  expect(recent).toHaveLength(20);
  expect(recent.map((run) => run.id)).not.toContain(older);

  await page.setViewportSize({ width: 390, height: 950 });
  await page.goto(`/?agent=${agent.agent.id}&run=${active}&view=runs`);
  const compareRuns = page.getByRole("button", { name: "Compare runs", exact: true });
  await compareRuns.click();
  const comparisonSearch = page.getByText("Search comparison runs", { exact: true });
  await comparisonSearch.click();
  const search = page.getByRole("searchbox", { name: "Search the archive" });
  const submit = page.getByRole("button", { name: "Search", exact: true });
  await search.fill("missing synthetic archive key");
  await submit.click();
  await expect(page.getByText("No saved runs match these filters.")).toBeVisible();
  await search.fill("breakevens baseline");
  await page.getByRole("combobox", { name: "Saved run status" }).selectOption("completed");
  await submit.click();
  const choices = page.getByRole("list", { name: "Saved runs", exact: true });
  await expect(choices.getByRole("button")).toHaveCount(1);
  await choices.getByRole("button", { name: new RegExp(older.slice(0, 8)) }).click();
  await expect(comparisonSearch).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Comparison run" })).toHaveValue(older);
  await expect(
    page.getByText(`Comparison run · ${older.slice(0, 8)}`, { exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("run")).toBe(active);
  expect(new URL(page.url()).searchParams.get("compare")).toBe(older);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy comparison link" }).click();
  await expect(page.getByText("Comparison link copied.")).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toBe(page.url());

  await page.getByRole("button", { name: "Model activity", exact: true }).click();
  await compareRuns.click();
  await expect(page.getByRole("combobox", { name: "Comparison run" })).toHaveValue(older);
  await page.goto(link);
  await expect(compareRuns).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText(`Comparison run · ${older.slice(0, 8)}`, { exact: true }),
  ).toBeVisible();

  const history = page.getByRole("complementary", { name: "Recent runs" });
  await history.getByRole("button", { name: "Recent runs", exact: true }).click();
  await history.getByText("Search saved runs", { exact: true }).click();
  await history.getByRole("button", { name: "Next page", exact: true }).click();
  await history
    .getByRole("list", { name: "Saved runs" })
    .getByRole("button", {
      name: new RegExp(older.slice(0, 8)),
    })
    .click();
  await expect.poll(() => new URL(page.url()).searchParams.get("run")).toBe(older);
  expect(new URL(page.url()).searchParams.get("compare")).toBeNull();

  await page.goto(`/?view=runs&run=${active}&compare=${foreign}`);
  await expect(
    page.getByRole("alert").filter({ hasText: "Select a comparison run from the same agent." }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Run comparison table" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Comparison run" }).selectOption("");
  expect(new URL(page.url()).searchParams.get("compare")).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
