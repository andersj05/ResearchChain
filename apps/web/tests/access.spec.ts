import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type PlaywrightWorkerArgs,
  type Route,
} from "@playwright/test";
import example from "../../../examples/research-workflow.json";
import { seed } from "./report-fixture";

test.describe.configure({ mode: "default" });
const password = process.env.RESEARCHCHAIN_TEST_OWNER_PASSWORD!;
const origin = process.env.RESEARCHCHAIN_PUBLIC_ORIGIN!;

function operator(command: string): { code?: string } {
  const python = resolve(
    "../api/.venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  const result = spawnSync(python, [resolve("../api/tests/access_browser_fixture.py"), command], {
    windowsHide: true,
    encoding: "utf-8",
  });
  expect(result.status, "Synthetic owner operation failed").toBe(0);
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

async function login(page: Page, value = password) {
  await page.getByLabel("Owner password", { exact: true }).fill(value);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
}

async function ownerApi(
  playwright: PlaywrightWorkerArgs["playwright"],
): Promise<APIRequestContext> {
  const anonymous = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  try {
    const response = await anonymous.post("/api/access/login", { data: { password } });
    expect(response.status()).toBe(200);
    const { session } = await response.json();
    return await playwright.request.newContext({
      baseURL: origin,
      storageState: await anonymous.storageState(),
      extraHTTPHeaders: { Origin: origin, "X-ResearchChain-CSRF": session.csrf_token },
    });
  } finally {
    await anonymous.dispose();
  }
}

test.beforeEach(() => {
  operator("reset");
});
test.afterEach(() => {
  operator("reset");
});

for (const width of [1440, 390]) {
  test(`owner sign-in, sign-out and unsaved workflow recovery at ${width}px`, async ({
    page,
    request,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?view=workflow");
    await expect(page.getByRole("heading", { name: "Owner sign-in", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Build", exact: true })).toHaveCount(0);
    expect((await request.get("/api/revisions")).status()).toBe(401);
    await page.getByLabel("Owner password", { exact: true }).fill("incorrect");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".access-card").getByRole("alert")).toContainText(
      "Sign-in was not accepted",
    );
    await page.screenshot({ path: info.outputPath("owner-signin.png"), fullPage: true });
    await login(page);
    const instructions = page.getByRole("textbox", { name: "Instructions", exact: true });
    await expect(page.getByRole("button", { name: "Run workflow", exact: true })).toBeEnabled();
    await instructions.fill("My unsaved owner draft.");
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/api/revisions"))
        writes.push(request.url());
    });
    const settingsButton = page.getByRole("button", { name: "Settings", exact: true });
    await settingsButton.click();
    const settings = page.getByRole("dialog", { name: "Workspace settings", exact: true });
    await expect(settings).toBeVisible();
    await expect(settings).toBeFocused();
    await page.getByLabel("New password", { exact: true }).fill("A temporary unsaved password");
    await page.keyboard.press("Tab");
    expect(await settings.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await expect(settingsButton).toBeFocused();
    await settingsButton.click();
    await expect(page.getByLabel("New password", { exact: true })).toHaveValue("");
    if (width === 1440) expect((await settings.boundingBox())!.height).toBeLessThan(650);
    await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath("owner-controls.png"), fullPage: true });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sign in again", exact: true })).toBeVisible();
    await expect(instructions).toBeHidden();
    await login(page);
    await expect(instructions).toHaveValue("My unsaved owner draft.");
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => document.cookie)).not.toContain("rc_session");
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(password);
    expect(errors).toEqual([]);
  });
}

test("first owner setup exchanges a link once and removes it from the address", async ({
  page,
  browser,
}) => {
  operator("unenroll");
  await page.goto("/");
  await expect(page.getByText("Set up owner access", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Owner password", { exact: true })).toHaveCount(0);
  const { code } = operator("link");
  expect(code).toBeTruthy();
  let exchanges = 0;
  const requestUrls: string[] = [];
  page.on("request", (request) => {
    requestUrls.push(request.url());
    if (request.url().endsWith("/api/access/exchange")) exchanges += 1;
  });
  await page.goto(`/#owner-link=${code}`);
  await expect(
    page.getByRole("textbox", { name: "Context for the lead (optional)", exact: true }),
  ).toBeVisible();
  expect(page.url()).not.toContain(code);
  expect(exchanges).toBe(1);
  expect(requestUrls.every((url) => !url.includes(code!))).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(code);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Create owner password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Save owner password", exact: true }).click();
  await expect(page.getByText("Password saved.", { exact: false })).toBeVisible();
  const another = await browser.newContext();
  try {
    const replay = await another.newPage();
    await replay.goto(`${origin}/#owner-link=${code}`);
    await expect(replay.locator(".access-card").getByRole("alert")).toContainText(
      "Sign-in was not accepted",
    );
    await expect(replay.getByRole("tab", { name: "Build", exact: true })).toHaveCount(0);
    await login(replay);
  } finally {
    await another.close();
  }
});

test("revoked report saves preserve the draft and reuse the pending request id", async ({
  page,
  playwright,
}) => {
  test.setTimeout(60000);
  page.on("dialog", (dialog) => dialog.accept());
  const api = await ownerApi(playwright);
  try {
    const { record } = await seed(api, crypto.randomUUID().slice(0, 8));
    await page.context().addCookies((await api.storageState()).cookies);
    await page.goto(`/?view=reports&report=${record.id}`);
    const text = page.getByRole("textbox", { name: "Section text", exact: true });
    await text.fill("Keep this draft when access expires.");
    await page
      .getByRole("textbox", { name: "Revision change note", exact: true })
      .fill("Synthetic access recovery.");
    const ids: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/api/reports/revisions"))
        ids.push(request.postDataJSON().id);
    });
    operator("revoke");
    await page.getByRole("button", { name: "Save report revision", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sign in again", exact: true })).toBeVisible();
    await expect(text).toBeHidden();
    expect(ids.length).toBe(1);
    await login(page);
    await expect(text).toHaveValue("Keep this draft when access expires.");
    expect(ids.length).toBe(1);
    await page.getByRole("button", { name: "Save report revision", exact: true }).click();
    await expect(page.getByText("Saved revision 2", { exact: true })).toBeVisible();
    expect(ids.length).toBe(2);
    expect(ids[1]).toBe(ids[0]);
    expect(
      (await (await page.request.get(`/api/reports/${record.id}/history`)).json()).length,
    ).toBe(2);
    const originals = await page.request.get(
      `/api/artifacts/${record.sources[0]!.artifact!.id}/content`,
    );
    expect(originals.status()).toBe(200);
  } finally {
    await api.dispose();
  }
});

test("a different owner cannot inherit the previous owner's open or stored draft", async ({
  page,
  playwright,
}) => {
  const api = await ownerApi(playwright);
  try {
    const revision = await (await api.post("/api/revisions", { data: example })).json();
    await page.context().addCookies((await api.storageState()).cookies);
    await page.goto(`/?revision=${revision.id}`);
    const instructions = page.getByRole("textbox", { name: "Instructions", exact: true });
    const view = page.getByRole("combobox", { name: "Visible connections", exact: true });
    await expect(page.getByRole("button", { name: "Run workflow", exact: true })).toBeEnabled();
    await view.selectOption("data");
    await instructions.fill("Private draft belonging to the first owner.");
    await page.getByText("Local draft & export", { exact: true }).click();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const firstPrefix = await page
      .locator("[data-owner-workspace]")
      .getAttribute("data-owner-workspace");
    operator("replace-owner");
    await page.getByRole("button", { name: "Validate workflow", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sign in again", exact: true })).toBeVisible();
    await login(page);
    await expect(page.getByRole("button", { name: "Run workflow", exact: true })).toBeEnabled();
    await expect(view).toHaveValue("all");
    await expect(instructions).not.toHaveValue("Private draft belonging to the first owner.");
    expect(
      await page.locator("[data-owner-workspace]").getAttribute("data-owner-workspace"),
    ).not.toBe(firstPrefix);
    await page.getByText("Local draft & export", { exact: true }).click();
    await page.getByRole("button", { name: "Load saved draft", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "No saved draft" })).toContainText(
      "No saved draft",
    );
    expect(
      await page.evaluate((key) => localStorage.getItem(key!), firstPrefix + ".workflow.v0.1"),
    ).toContain("Private draft belonging to the first owner.");
  } finally {
    await api.dispose();
  }
});

test("password rotation refreshes other tabs and sign-out hides both workspaces", async ({
  page,
  playwright,
}) => {
  const api = await ownerApi(playwright);
  try {
    await page.context().addCookies((await api.storageState()).cookies);
    const pendingRead = Promise.withResolvers<Route>();
    await page.route("**/api/runs", (route) => pendingRead.resolve(route), { times: 1 });
    await page.goto("/?view=workflow");
    const oldRead = await pendingRead.promise;
    await expect(page.getByRole("tab", { name: "Build", exact: true })).toBeVisible();
    const other = await page.context().newPage();
    await other.goto("/?view=workflow");
    await expect(
      other.getByRole("button", { name: "Validate workflow", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("New password", { exact: true }).fill(password + "-changed");
    const refreshed = other.waitForResponse("**/api/access/status");
    await page.getByRole("button", { name: "Save owner password", exact: true }).click();
    await expect(page.getByText("Password saved.", { exact: false })).toBeVisible();
    await (await refreshed).finished();
    // Deliver the old session's actual response after the browser has the replacement cookie.
    const rejected = await api.get("/api/runs");
    expect(rejected.status()).toBe(401);
    const delivered = page.waitForResponse("**/api/runs");
    await oldRead.fulfill({ response: rejected });
    await (await delivered).finished();
    await other.getByRole("button", { name: "Validate workflow", exact: true }).click();
    await expect(other.getByRole("status", { name: "Workspace status" })).toHaveText(
      "Workflow valid. Ready to run.",
    );
    await page.getByRole("button", { name: "Sign out all sessions", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sign in again", exact: true })).toBeVisible();
    await expect(other.getByRole("heading", { name: "Sign in again", exact: true })).toBeVisible();
    await expect(other.getByRole("tab", { name: "Build", exact: true })).toBeHidden();
  } finally {
    await api.dispose();
  }
});

test("pre-sign-in drafts require an explicit owner import", async ({ page }) => {
  await page.goto("/?view=workflow");
  await page.evaluate(
    (workflow) => {
      localStorage.setItem("researchchain.workflow.v0.1", JSON.stringify(workflow));
    },
    {
      ...example,
      nodes: example.nodes.map((node, i) =>
        i ? node : { ...node, instructions: "A draft saved before owner access." },
      ),
    },
  );
  await login(page);
  await expect(page.getByRole("button", { name: "Run workflow", exact: true })).toBeEnabled();
  const instructions = page.getByRole("textbox", { name: "Instructions", exact: true });
  await expect(instructions).not.toHaveValue("A draft saved before owner access.");
  await page.getByText("Local draft & export", { exact: true }).click();
  await page
    .getByRole("button", { name: "Import my draft saved before sign-in", exact: true })
    .click();
  await expect(instructions).toHaveValue("A draft saved before owner access.");
  expect(
    await page.evaluate(() => localStorage.getItem("researchchain.legacy-drafts.owner")),
  ).toBeTruthy();
  expect(await page.evaluate(() => localStorage.getItem("researchchain.workflow.v0.1"))).toContain(
    "A draft saved before owner access.",
  );
});
