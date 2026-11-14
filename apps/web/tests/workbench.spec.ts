import { expect, test } from "@playwright/test";
import example from "../../../examples/research-workflow.json";

test.beforeEach(async ({ page, request }) => {
  const saved = await request.post("/api/revisions", { data: example });
  expect(saved.status()).toBe(201);
  await page.goto(`/?revision=${(await saved.json()).id}`);
  await expect(page.getByRole("button", { name: "Run workflow" })).toBeEnabled();
});

test("save a revision, refresh a paused run, and resume its original workflow", async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page
    .getByRole("textbox", { name: "Instructions", exact: true })
    .fill("Compare competing explanations.");
  await page.getByRole("button", { name: "Save revision", exact: true }).click();
  await expect(page.getByRole("status", { name: "Workspace status" })).toHaveText(
    /Revision \d+ saved\./,
  );
  await page.getByRole("button", { name: "Validate workflow", exact: true }).click();
  await expect(page.getByRole("status", { name: "Workspace status" })).toHaveText(
    "Workflow valid. Ready to run.",
  );
  await page.screenshot({ path: testInfo.outputPath("workflow-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Run workflow" }).click();
  await expect(page.getByRole("heading", { name: "Run paused" })).toBeVisible();
  const runUrl = page.url();
  await page.getByRole("tab", { name: "Workflow", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Instructions", exact: true })
    .fill("Only for the next run.");
  await page.getByRole("button", { name: "Save revision", exact: true }).click();
  await expect(page.getByRole("status", { name: "Workspace status" })).toHaveText(
    /Revision \d+ saved\./,
  );
  await page.getByRole("tab", { name: "Runs", exact: true }).click();
  await expect(page.getByRole("region", { name: "Run inspector" })).toContainText(
    "Compare competing explanations.",
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "Run paused" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("run-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Approve and continue" }).click();
  await expect(page.getByRole("heading", { name: "Run completed" })).toBeVisible();
  await page.goto(runUrl);
  await expect(page.getByRole("heading", { name: "Run completed" })).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("revision history restores the draft and Undo preserves unsaved work", async ({ page }) => {
  const firstText = "Saved revision for the history test.";
  await page.getByRole("textbox", { name: "Instructions", exact: true }).fill(firstText);
  await page.getByRole("button", { name: "Save revision", exact: true }).click();
  await expect(page.getByRole("status", { name: "Workspace status" })).toHaveText(
    /Revision \d+ saved\./,
  );
  const number = (await page.getByRole("status", { name: "Workspace status" }).innerText()).match(
    /\d+/,
  )![0];
  await page
    .getByRole("textbox", { name: "Instructions", exact: true })
    .fill("Unsaved work to recover.");
  await page.getByRole("tab", { name: "Revisions", exact: true }).click();
  await page.getByRole("button", { name: `Load revision ${number}`, exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Instructions", exact: true })).toHaveValue(
    firstText,
  );
  await page.getByRole("button", { name: "Undo last edit" }).click();
  await expect(page.getByRole("textbox", { name: "Instructions", exact: true })).toHaveValue(
    "Unsaved work to recover.",
  );
});

test("local drafts and JSON export remain available", async ({ page }) => {
  await page
    .getByRole("textbox", { name: "Instructions", exact: true })
    .fill("Browser-only draft.");
  await page.getByText("Local draft & export", { exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status", { name: "Workspace status" })).toHaveText(
    "Draft saved in this browser.",
  );
  await page.getByRole("textbox", { name: "Instructions", exact: true }).fill("Another edit.");
  await page.getByRole("button", { name: "Load saved draft" }).click();
  await expect(page.getByRole("textbox", { name: "Instructions", exact: true })).toHaveValue(
    "Browser-only draft.",
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("researchchain-workflow.json");
});

test("invalid connections cannot be saved or executed", async ({ page }) => {
  await page.getByRole("combobox", { name: "Next node", exact: true }).selectOption("");
  await page.getByRole("button", { name: "Save revision", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "connected chain" })).toBeVisible();
  await page.getByRole("button", { name: "Run workflow" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "connected chain" })).toBeVisible();
  await page.getByRole("button", { name: "Undo last edit" }).click();
  await expect(page.getByRole("combobox", { name: "Next node", exact: true })).toHaveValue(
    "challenge",
  );
});

test("a lost start response reopens the accepted run", async ({ page }) => {
  let runId = "";
  await page.route("**/api/runs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    runId = (await response.json()).id;
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Run workflow" }).click();
  await expect(page.getByRole("heading", { name: "Run paused" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("run")).toBe(runId);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Run paused" })).toBeVisible();
});

test("stale review controls refresh without approving a later review", async ({
  page,
  request,
}) => {
  const workflow = structuredClone(example);
  workflow.nodes[1]!.kind = "review";
  const revision = await (await request.post("/api/revisions", { data: workflow })).json();
  await page.goto(`/?revision=${revision.id}`);
  await page.getByRole("button", { name: "Run workflow" }).click();
  await expect(page.getByRole("heading", { name: "Run paused" })).toBeVisible();
  const id = new URL(page.url()).searchParams.get("run");
  const first = await (await request.get(`/api/runs/${id}`)).json();
  await request.post(`/api/runs/${id}/resume`, {
    data: {
      checkpoint_id: first.checkpoint_id,
      interrupt_id: first.review.interrupt_id,
      decision: "approve",
    },
  });
  await page.getByRole("button", { name: "Approve and continue" }).click();
  await expect(page.getByRole("heading", { name: "Run paused" })).toBeVisible();
  await expect(page.locator(".review-box h3")).toHaveText(workflow.nodes[2]!.instructions);
  const current = await (await request.get(`/api/runs/${id}`)).json();
  expect(current.review.node_id).toBe("review");
  expect(current.events).toHaveLength(2);
});

test("canvas movement and workspace tabs support the keyboard", async ({ page }) => {
  const node = page.getByRole("button", { name: "Edit Frame the question", exact: true });
  await node.focus();
  await node.press("Alt+ArrowRight");
  await expect(node).toHaveCSS("left", "70px");
  const tab = page.getByRole("tab", { name: "Workflow", exact: true });
  await tab.focus();
  await tab.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Runs", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("workflow, runs, and revisions fit a narrow screen", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Run workflow" }).click();
  await expect(page.getByRole("heading", { name: "Run paused" })).toBeVisible();
  for (const name of ["Workflow", "Runs", "Revisions"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`${name.toLowerCase()}-mobile.png`),
      fullPage: true,
    });
    const layout = await page.evaluate(() => ({
      fits: document.documentElement.scrollWidth <= window.innerWidth,
      overflowing: [...document.querySelectorAll("body *")]
        .filter((element) => element.getBoundingClientRect().right > window.innerWidth)
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
          right: element.getBoundingClientRect().right,
        }))
        .slice(0, 20),
    }));
    expect(layout.fits, JSON.stringify(layout.overflowing)).toBe(true);
  }
});

test("a recoverable run exposes an explicit recovery action", async ({ page }) => {
  await page.getByRole("button", { name: "Run workflow" }).click();
  await expect(page.getByRole("heading", { name: "Run paused" })).toBeVisible();
  const id = new URL(page.url()).searchParams.get("run");
  // Exercise the interrupted-state UI independently of backend crash injection.
  // The recover endpoint below still executes against the real Postgres run.
  await page.route(`**/api/runs/${id}`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), status: "interrupted" } });
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Run interrupted" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve and continue" })).toHaveCount(0);
  await page.unroute(`**/api/runs/${id}`);
  const recovered = page.waitForResponse(
    (response) => response.url().endsWith(`/runs/${id}/recover`) && response.status() === 200,
  );
  await page.getByRole("button", { name: "Recover run" }).click();
  await recovered;
  await expect(page.getByRole("heading", { name: "Run paused" })).toBeVisible();
});
