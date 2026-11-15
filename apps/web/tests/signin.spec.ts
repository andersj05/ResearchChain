import { expect, test, type APIRequestContext, type Page } from "./fixtures";
import research from "../../../examples/hypothesis-research.json";

const endpoint = "/api/providers/chatgpt/sign-in";

async function openConnection(page: Page, request: APIRequestContext) {
  const saved = await request.post("/api/revisions", { data: research });
  expect(saved.ok()).toBe(true);
  await page.goto(`/?revision=${(await saved.json()).id}`);
  await page.getByRole("button", { name: "Validate workflow", exact: true }).click();
  await expect(page.getByRole("status", { name: "Workspace status" })).toHaveText(
    "Workflow valid. Ready to run.",
  );
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  await expect(page.getByText("Connected as Synthetic", { exact: true })).toBeVisible();
}

async function providerRedirect(page: Page, decline = false) {
  await page.context().route("**/continue/**", async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    expect(response.status()).toBe(303);
    const authorization = new URL(response.headers()["location"]!);
    expect(authorization.origin).toBe("https://auth.openai.com");
    expect(authorization.searchParams.get("prompt")).toBe("consent");
    const callback = new URL(authorization.searchParams.get("redirect_uri")!);
    callback.searchParams.set("state", authorization.searchParams.get("state")!);
    callback.searchParams.set("client_id", "oaiapp_synthetic_test_registration");
    callback.searchParams.set(
      decline ? "error" : "code",
      decline ? "access_denied" : "synthetic-code",
    );
    await route.fulfill({ status: 303, headers: { location: callback.href } });
  });
}

for (const width of [1440, 390]) {
  test(`connect from workbench and recover pending sign-in on ${width}px`, async ({
    page,
    request,
  }, testInfo) => {
    testInfo.setTimeout(60000);
    await page.setViewportSize({ width, height: 1100 });
    let starts = 0;
    let modelReads = 0;
    page.on("request", (request) => {
      if (request.url().endsWith(endpoint) && request.method() === "POST") starts += 1;
      if (request.url().endsWith("/api/providers/chatgpt") && request.method() === "GET")
        modelReads += 1;
    });
    await openConnection(page, request);
    // Losing the POST response must recover through GET, not another start.
    if (width === 1440) {
      await page.route(`**${endpoint}`, async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        await route.fetch();
        await route.abort("failed");
      });
    }
    await page.getByRole("button", { name: "Reconnect ChatGPT", exact: true }).click();
    const link = page.getByRole("link", { name: "Open sign-in page" });
    await expect(link).toBeVisible();
    const entry = await link.getAttribute("href");
    const pending = await (await request.get(endpoint)).json();
    expect(pending.state).toBe("waiting");
    await page.reload();
    await page.getByRole("button", { name: "Run workflow", exact: true }).click();
    await expect(link).toHaveAttribute("href", entry!);
    expect(starts).toBe(1);
    expect((await (await request.get(endpoint)).json()).id).toBe(pending.id);
    const panel = page.getByRole("group", { name: "ChatGPT plan usage", exact: true });
    await panel.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await panel.screenshot({ path: testInfo.outputPath(`chatgpt-connect-${width}.png`) });
    const readsBefore = modelReads;
    await providerRedirect(page);
    const popupReady = page.waitForEvent("popup");
    await link.click();
    const popup = await popupReady;
    await expect(popup.getByRole("heading", { name: "Use your ChatGPT plan" })).toBeVisible();
    await popup.getByRole("button", { name: "Continue with ChatGPT", exact: true }).click();
    await expect(
      popup.getByRole("heading", { name: /ChatGPT reconnected|You're using your ChatGPT plan/ }),
    ).toBeVisible();
    await expect(page.getByRole("status", { name: "ChatGPT sign-in status" })).toHaveText(
      "ChatGPT connected. Plan usage is enabled.",
    );
    await expect.poll(() => modelReads).toBeGreaterThan(readsBefore);
    await expect(
      page.getByRole("button", { name: "Reconnect ChatGPT", exact: true }),
    ).toBeEnabled();
    await expect(link).toHaveCount(0);
    await panel.screenshot({ path: testInfo.outputPath(`chatgpt-ready-${width}.png`) });
    await popup.close();
    expect(starts).toBe(1);
  });
}

test("cancel a pending sign-in and start again without losing the saved account", async ({
  page,
  request,
}) => {
  await openConnection(page, request);
  await page.getByRole("button", { name: "Reconnect ChatGPT", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open sign-in page" })).toBeVisible();
  const first = await (await request.get(endpoint)).json();
  await page.getByRole("button", { name: "Cancel sign-in", exact: true }).click();
  await expect(page.getByRole("status", { name: "ChatGPT sign-in status" })).toContainText(
    "Sign-in cancelled",
  );
  await expect(page.getByText("Connected as Synthetic", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reconnect ChatGPT", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open sign-in page" })).toBeVisible();
  const second = await (await request.get(endpoint)).json();
  expect(second.id).not.toBe(first.id);
  expect((await request.post(`${endpoint}/${first.id}/cancel`)).status()).toBe(409);
  await page.getByRole("button", { name: "Cancel sign-in", exact: true }).click();
  await expect(page.getByRole("status", { name: "ChatGPT sign-in status" })).toContainText(
    "Sign-in cancelled",
  );
});

test("declined consent reports failure and leaves reconnection available", async ({
  page,
  request,
}) => {
  await openConnection(page, request);
  await providerRedirect(page, true);
  await page.getByRole("button", { name: "Reconnect ChatGPT", exact: true }).click();
  const link = page.getByRole("link", { name: "Open sign-in page" });
  await expect(link).toBeVisible();
  const popupReady = page.waitForEvent("popup");
  await link.click();
  const popup = await popupReady;
  await popup.getByRole("button", { name: "Continue with ChatGPT", exact: true }).click();
  await expect(popup.getByRole("heading", { name: "Sign-in did not complete" })).toBeVisible();
  await expect(page.getByRole("status", { name: "ChatGPT sign-in status" })).toContainText(
    "declined",
  );
  await expect(page.getByRole("button", { name: "Reconnect ChatGPT", exact: true })).toBeEnabled();
  await expect(page.getByText("Connected as Synthetic", { exact: true })).toBeVisible();
  await popup.close();
});

test("expired sign-in hides the old link and status errors can be checked without starting", async ({
  page,
  request,
}) => {
  let unavailable = true;
  let starts = 0;
  await page.route(`**${endpoint}`, async (route) => {
    if (route.request().method() === "POST") {
      starts += 1;
      return route.abort();
    }
    await route.fulfill({
      status: unavailable ? 503 : 200,
      json: unavailable
        ? { detail: "Status temporarily unavailable." }
        : {
            available: true,
            id: "00000000-0000-0000-0000-000000000001",
            state: "expired",
            url: "http://127.0.0.1:1/start/expired",
            expires_at: null,
            message: "Sign-in expired. Start again when you are ready.",
          },
    });
  });
  await openConnection(page, request);
  await expect(
    page.getByRole("group", { name: "ChatGPT plan usage", exact: true }).getByRole("alert"),
  ).toContainText("Status temporarily unavailable.");
  unavailable = false;
  await page.getByRole("button", { name: "Check sign-in status", exact: true }).click();
  await expect(page.getByRole("status", { name: "ChatGPT sign-in status" })).toContainText(
    "Sign-in expired",
  );
  await expect(page.getByRole("link", { name: "Open sign-in page" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reconnect ChatGPT", exact: true })).toBeEnabled();
  expect(starts).toBe(0);
});
