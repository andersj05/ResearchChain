import { blankResearchBrief } from "../src/lib/research-sessions";
import { pinDeskNote } from "./desk-material";
import { expect, test } from "./fixtures";

test("start with the edited settings while the first-reading action stays visible", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const start = page.getByRole("button", { name: "Ask the lead for a first reading" });
  await expect(start).toBeInViewport();
  await expect(start).toBeDisabled();
  await expect(page.getByRole("link", { name: "Pin a source to begin" })).toBeInViewport();
  const setup = page.getByRole("complementary", { name: "Prepare the first reading" });
  await expect(setup.getByText("First-reading model", { exact: true })).toBeVisible();
  await expect(setup.getByText(/Astra 6\.2/)).toBeVisible();
  await expect(setup.getByText("High effort · High detail", { exact: true })).toBeVisible();
  await expect(setup.getByText("Off", { exact: true })).toBeVisible();

  const settings = page.getByRole("navigation", { name: "Study sections" });
  await settings.getByRole("link", { name: "Saved sources" }).press("Enter");
  await expect(page.getByRole("region", { name: "Source library" })).toBeFocused();
  await settings.getByRole("link", { name: "Recent research" }).press("Enter");
  await expect(page.getByRole("region", { name: "Recent research" })).toBeFocused();
  await page.getByRole("link", { name: "Pin a source to begin" }).press("Enter");
  await expect(page.getByRole("heading", { name: "Add material" })).toBeFocused();

  const sourceId = await pinDeskNote(page);
  await settings.getByRole("link", { name: "Research settings" }).click();
  const lead = page.getByRole("group", { name: "Research lead", exact: true });
  await lead
    .getByRole("group", { name: "Thinking effort control" })
    .getByRole("button", { name: "Use model default" })
    .click();
  await expect(
    setup.getByText("Model default effort · High detail", { exact: true }),
  ).toBeVisible();
  await lead
    .getByRole("group", { name: "Response detail control" })
    .getByRole("button", { name: "Use model default" })
    .click();
  await expect(
    setup.getByText("Model default effort · Model default detail", { exact: true }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "Allow live web search" }).check();
  await expect(setup.getByText("On", { exact: true })).toBeVisible();
  await page.getByRole("spinbutton", { name: "Passes per agent" }).fill("5");
  const roleSettings = page.getByRole("heading", {
    name: /^(Research lead|Researchers|Report editor)$/,
  });
  await expect(roleSettings).toHaveCount(3);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole("spinbutton", { name: "Passes per agent" }).scrollIntoViewIfNeeded();
    await expect(start).toBeInViewport({ ratio: 1 });
    await expect(start).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const tops = await roleSettings.evaluateAll((headings) =>
      headings.map((heading) => Math.round(heading.getBoundingClientRect().top)),
    );
    expect(new Set(tops).size, `Role heading rows at ${width}px`).toBe(width === 1280 ? 1 : 3);
    await page.screenshot({ path: info.outputPath(`first-reading-action-${width}.png`) });
  }
  await page.route("**/api/research-sessions", (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  const started = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/api/research-sessions"),
  );
  await start.click();
  expect((await started).postDataJSON()).toMatchObject({
    evidence_ids: [sourceId],
    max_passes: 5,
    web_search: true,
    start_from_sources: true,
    lead: { reasoning_effort: "model_default", verbosity: "model_default" },
  });
});

test("explain a rejected first reading beside the action and keep the editable packet", async ({
  ownerSession,
  page,
  request,
}) => {
  const title = `Quoted notes ${crypto.randomUUID().slice(0, 8)}`;
  const source = await request.post("/api/evidence", {
    data: {
      id: crypto.randomUUID(),
      title,
      kind: "text",
      rights: "owned",
      text: '\\"\n'.repeat(2500),
    },
  });
  expect(source.ok()).toBeTruthy();
  const sourceId = (await source.json()).id;
  await page.addInitScript(
    ({ key, draft }) => {
      if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify({ draft }));
    },
    {
      key: `${ownerSession.prefix}.research-brief.new`,
      draft: {
        ...blankResearchBrief,
        model: "test-model",
        evidence_ids: [sourceId],
        max_input_bytes: 16000,
      },
    },
  );
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await page.getByRole("link", { name: "Research settings", exact: true }).click();
  const start = page.getByRole("button", { name: "Ask the lead for a first reading" });
  await expect(start).toBeEnabled();
  const submitted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith("/api/research-sessions"),
  );
  await start.click();
  expect((await submitted).status()).toBe(422);
  const error = page.getByRole("alert").filter({ hasText: "input byte limit" });
  await expect(error).toBeInViewport();
  await expect(error).toContainText("Unpin a source");
  await expect(start).toBeEnabled();
  const sample = page.getByLabel("Import a text or Markdown sample");
  await sample.evaluate((input) => input.scrollIntoView({ block: "end" }));
  await expect
    .poll(async () => {
      const input = await sample.boundingBox();
      const alert = await error.boundingBox();
      return Boolean(input && alert && input.y + input.height <= alert.y);
    })
    .toBe(true);
  await expect(page.getByRole("list", { name: "Pinned material" })).toContainText(title);
  const id = (await submitted).request().postDataJSON().id;
  expect((await request.get(`/api/research-sessions/${id}/setup`)).status()).toBe(404);
});
