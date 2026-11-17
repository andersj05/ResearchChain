import { expect, test } from "./fixtures";
import example from "../../../examples/research-workflow.json";

test("sidebars resize by pointer and keyboard, remember widths, and preserve the workflow", async ({
  page,
  request,
}, info) => {
  const saved = await request.post("/api/revisions", { data: example });
  expect(saved.status()).toBe(201);
  const revision = await saved.json();
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.goto(`/?revision=${revision.id}`);
  const steps = page.getByRole("separator", { name: "Resize steps panel", exact: true });
  const details = page.getByRole("separator", { name: "Resize details panel", exact: true });
  const library = page.locator("#step-library");
  const inspector = page.locator("#node-inspector");
  await expect(steps).toBeVisible();
  const before = (await library.boundingBox())!.width;
  const handle = (await steps.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 140);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 80, handle.y + 140, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await library.boundingBox())!.width).toBeGreaterThan(before + 60);
  const initialDetails = (await inspector.boundingBox())!.width;
  await details.focus();
  await details.press("ArrowLeft");
  await expect
    .poll(async () => (await inspector.boundingBox())!.width)
    .toBeGreaterThan(initialDetails + 5);
  const widths = [(await library.boundingBox())!.width, (await inspector.boundingBox())!.width];
  await page.reload();
  await expect(steps).toBeVisible();
  await expect.poll(async () => (await library.boundingBox())!.width).toBeCloseTo(widths[0]!, 0);
  await expect.poll(async () => (await inspector.boundingBox())!.width).toBeCloseTo(widths[1]!, 0);
  await steps.press("Enter");
  await expect(library).toBeHidden();
  await expect(page.getByRole("button", { name: "Toggle steps", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.getByRole("button", { name: "Toggle steps", exact: true }).click();
  await expect(library).toBeVisible();
  await expect.poll(async () => (await library.boundingBox())!.width).toBeCloseTo(widths[0]!, 0);
  await page.getByRole("button", { name: "Toggle details", exact: true }).click();
  await expect(inspector).toBeHidden();
  await page.getByRole("button", { name: "Toggle details", exact: true }).click();
  await expect(inspector).toBeVisible();
  await expect(page.locator(".save-state")).toHaveText(`Revision ${revision.number}`);
  await expect(page.getByRole("button", { name: "Undo last edit", exact: true })).toBeDisabled();
  await steps.press("End");
  await details.press("Home");
  expect((await page.locator(".canvas").boundingBox())!.width).toBeGreaterThanOrEqual(319);
  await page.screenshot({ path: info.outputPath("resizable-desktop.png"), fullPage: true });

  await page.getByRole("textbox", { name: "Step name", exact: true }).fill("My retained draft");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(steps).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(
    "My retained draft",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("resizable-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1040 });
  await expect(steps).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(
    "My retained draft",
  );
  expect((await (await request.get(`/api/revisions/${revision.id}`)).json()).workflow).toEqual(
    revision.workflow,
  );
});
