import { expect, test } from "./fixtures";
import { seed } from "./report-fixture";

for (const width of [1440, 390]) {
  test(`collection filters preserve selected records and source links on ${width}px`, async ({
    page,
    request,
  }, info) => {
    test.setTimeout(90000);
    const tag = crypto.randomUUID().slice(0, 8);
    const { source, chart, run, record, guide } = await seed(request, tag);
    const linkResponse = await request.post("/api/evidence", {
      data: {
        id: crypto.randomUUID(),
        title: `Unavailable ${tag}`,
        kind: "report",
        source_url: "https://example.test/unavailable",
        availability: "paywalled",
      },
    });
    expect(linkResponse.status(), await linkResponse.text()).toBe(201);
    const unavailable = await linkResponse.json();
    for (const [evidence, text] of [
      [source, `Linked claim ${tag}`],
      [chart, `Other claim ${tag}`],
    ]) {
      const response = await request.post("/api/claims", {
        data: {
          id: crypto.randomUUID(),
          text,
          kind: "hypothesis",
          links: [
            { evidence_id: evidence.id, relation: "context", rationale: "Synthetic UI fixture." },
          ],
        },
      });
      expect(response.status()).toBe(201);
    }
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/?view=evidence&evidence=${source.id}`);
    const sources = page.getByRole("complementary", { name: "Sources", exact: true });
    const details = page.getByRole("article", { name: "Source inspection" });
    const claims = page.getByRole("region", { name: "Saved claims" });
    await expect(details).toContainText(source.title);
    await page.getByLabel("Claims linked to this source").check();
    await expect(claims).toContainText(`Linked claim ${tag}`);
    await expect(claims).not.toContainText(`Other claim ${tag}`);
    await page.getByLabel("Find a loaded source").fill(tag);
    await page.getByLabel("Availability", { exact: true }).selectOption("paywalled");
    await expect(sources.locator(".source-list-item")).toHaveCount(1);
    await expect(details).toContainText(source.title);
    await sources.getByRole("button", { name: new RegExp(unavailable.title) }).click();
    await expect(details).toContainText("Paywalled");
    await expect(claims).toContainText("No loaded claims link to this source.");
    if (width > 850) {
      const handle = page.getByRole("separator", { name: "Resize sources list", exact: true });
      const before = (await sources.boundingBox())!.width;
      await handle.focus();
      await handle.press("ArrowRight");
      await expect
        .poll(async () => (await sources.boundingBox())!.width)
        .toBeGreaterThan(before + 5);
      const resized = (await sources.boundingBox())!.width;
      await page.reload();
      await expect(details).toContainText(unavailable.title);
      await expect.poll(async () => (await sources.boundingBox())!.width).toBeCloseTo(resized, 0);
    } else {
      await expect(page.getByRole("separator", { name: "Resize sources list" })).toHaveCount(0);
    }
    await page.screenshot({ path: info.outputPath("sources.png"), fullPage: true });
    await page.getByRole("button", { name: "Add source", exact: true }).click();
    await page.getByLabel("Source title", { exact: true }).fill(`Unsaved source ${tag}`);
    await page.setViewportSize({ width: width > 850 ? 390 : 1440, height: 1000 });
    await expect(page.getByLabel("Source title", { exact: true })).toHaveValue(
      `Unsaved source ${tag}`,
    );
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole("button", { name: "Cancel source", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    await page.goto(`/?view=runs&run=${run.id}`);
    const history = page.getByRole("complementary", { name: "Recent runs" });
    if (width <= 850) {
      const toggle = history.getByRole("button", { name: "Recent runs", exact: true });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByLabel("Find a recent run")).toBeHidden();
      await toggle.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
    }
    await page.getByLabel("Find a recent run").fill(run.id);
    await expect(history.locator(".run-row")).toHaveCount(1);
    await page.getByRole("combobox", { name: "Run status", exact: true }).selectOption("failed");
    await expect(history).toContainText("No recent runs match these filters.");
    await expect(history).toContainText("Its details remain visible.");
    await expect(page.getByRole("heading", { name: "Run paused", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Run status", exact: true }).selectOption("paused");
    await expect(history.locator(".run-row")).toHaveCount(1);
    if (width > 850) {
      const handle = page.getByRole("separator", { name: "Resize runs list", exact: true });
      const before = (await history.boundingBox())!.width;
      const box = (await handle.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 60, box.y + 100, { steps: 8 });
      await page.mouse.up();
      await expect
        .poll(async () => (await history.boundingBox())!.width)
        .toBeGreaterThan(before + 40);
    }
    await expect(history.locator(".run-row").first()).toBeInViewport({ ratio: 0.8 });
    await page.screenshot({ path: info.outputPath("runs.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    const second = await request.post("/api/reports", {
      data: {
        id: crypto.randomUUID(),
        title: `A report ${tag}`,
        run_id: run.id,
        attempt_id: run.model_attempts[0].id,
        style_guide_id: guide.id,
      },
    });
    expect(second.status()).toBe(201);
    await page.goto("/?view=reports");
    await page.getByLabel("Find a recent report").fill(tag);
    await page.getByRole("combobox", { name: "Sort reports", exact: true }).selectOption("title");
    const rows = page.locator(".report-browser-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText(`A report ${tag}`);
    await expect(rows.last()).toContainText(record.title);
    await page.screenshot({ path: info.outputPath("reports.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await rows.last().click();
    await expect(page.getByRole("heading", { name: record.title, exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("report")).toBe(record.id);
    expect((await (await request.get(`/api/evidence/${unavailable.id}`)).json()).availability).toBe(
      "paywalled",
    );
    expect((await (await request.get(`/api/reports/${record.id}`)).json()).revision).toEqual(
      record,
    );
  });
}
