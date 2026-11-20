import { expect, test } from "./fixtures";
import type { AgentDetail } from "../src/lib/workflow";
import sample from "../../../examples/idea-generation-brief.json";
import example from "../../../examples/idea-generation.json";

test("create the idea generation demo with its own saved graph and sample brief", async ({
  page,
  request,
}) => {
  await page.goto("/?view=workflow");
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create an agent" });
  await dialog.getByLabel("Starting workflow").selectOption({ label: "Idea generation demo" });
  await expect(dialog.getByLabel("Agent name")).toHaveValue(example.name);
  await dialog.getByLabel("Agent name").fill("My rotation experiment");
  await dialog.getByRole("button", { name: "Create agent", exact: true }).click();
  await expect(dialog).toBeHidden();
  const selector = page.getByRole("combobox", { name: "Agent", exact: true });
  const agentId = await selector.inputValue();
  const agent: AgentDetail = await (await request.get(`/api/agents/${agentId}`)).json();
  expect(agent.agent.name).toBe("My rotation experiment");
  expect(agent.agent.version).toBe(1);
  const analyst = agent.revision.workflow.nodes.find((node) => node.id === "investigate");
  expect(analyst?.config).toMatchObject({ analyst: { workspace: true, max_passes: 30 } });
  expect(analyst?.inputs?.feedback).toMatchObject({ node_id: "direction", port: "feedback" });
  expect(await (await request.get(`/api/runs?agent_id=${agentId}`)).json()).toEqual([]);
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  const brief = page.getByRole("textbox", { name: "Research brief", exact: true });
  await expect(brief).toHaveValue(sample.join("\n"));
  await brief.fill("Keep my test direction.");
  await page.getByRole("button", { name: "Append synthetic rotation brief", exact: true }).click();
  await expect(brief).toHaveValue("Keep my test direction.\n\n" + sample.join("\n"));
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await expect(selector).toHaveValue(agentId);
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  await expect(brief).toHaveValue("Keep my test direction.\n\n" + sample.join("\n"));
});
