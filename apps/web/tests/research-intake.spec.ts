import { expect, test } from "./fixtures";

test("source entry keeps invalid files actionable and identifies packets above the model limit", async ({
  page,
}) => {
  const id = crypto.randomUUID();
  const source = {
    id,
    title: "Synthetic large PDF",
    kind: "report",
    availability: "available",
    representation: "original",
    artifact: {
      id: "sha256:" + "a".repeat(64),
      media_type: "application/pdf",
      byte_size: 6_100_000,
    },
  };
  await page.route("**/api/evidence?*", (route) =>
    route.fulfill({ json: { items: [source], total: 1 } }),
  );
  await page.route("**/api/evidence/" + id, (route) => route.fulfill({ json: source }));
  await page.goto("/");
  await page.getByLabel("Usage rights").selectOption("owned");
  await page
    .getByLabel("Source files")
    .setInputFiles({ name: "empty.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) });
  await expect(page.getByText("Choose a file between 1 byte and 20 MB.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pin 1 file", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Remove queued empty.txt" }).click();
  await page.getByRole("checkbox", { name: source.title }).check();
  const start = page.getByRole("button", { name: "Ask the lead for a first reading" });
  await expect(
    page.getByRole("alert").filter({ hasText: "fills the request limit" }),
  ).toBeVisible();
  await expect(start).toBeDisabled();
  await page.getByRole("button", { name: "Unpin " + source.title }).click();
  await page.getByRole("button", { name: "Link", exact: true }).click();
  await page.getByLabel("Original URL").fill("https://example.org/synthetic-reference");
  await page.getByRole("button", { name: "Pin link", exact: true }).click();
  await expect(page.getByRole("list", { name: "Pinned material" })).toContainText("Link only");
  await expect(start).toBeEnabled();
});

test("drop a week of files, retry a lost receipt and keep the pinned packet in order", async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto("/");
  const bodies: { id: string; title: string; author: string; kind: string }[] = [];
  await page.route("**/api/evidence", async (route) => {
    const body = route.request().postDataJSON();
    if (body.title !== "desk-call.txt") return route.continue();
    bodies.push(body);
    if (bodies.length === 1) {
      expect((await route.fetch()).ok()).toBeTruthy();
      return route.abort();
    }
    return route.continue();
  });
  const transfer = await page.evaluateHandle(() => {
    const batch = new DataTransfer();
    // A tiny real chart keeps this rehearsal local and within the provider byte limit.
    const canvas = document.createElement("canvas");
    canvas.width = 220;
    canvas.height = 90;
    const ctx = canvas.getContext("2d")!;
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = "#f7f7f7";
      ctx.fillRect(0, 0, 220, 90);
      ctx.strokeStyle = "#333";
      ctx.beginPath();
      ctx.moveTo(10, 70 - i);
      ctx.lineTo(88, 46 + i);
      ctx.lineTo(140, 58 - i);
      ctx.lineTo(210, 22 + i * 2);
      ctx.stroke();
      const bytes = Uint8Array.from(atob(canvas.toDataURL().split(",")[1]!), (c) =>
        c.charCodeAt(0),
      );
      batch.items.add(new File([bytes], `Week ${i + 1}.png`, { type: "image/png" }));
    }
    batch.items.add(
      new File(["A synthetic observation from Friday's desk call."], "desk-call.txt", {
        type: "text/plain",
      }),
    );
    batch.items.add(
      new File(["period\tcount\n1\t5\n2\t7"], "weekly.tsv", { type: "text/tab-separated-values" }),
    );
    return batch;
  });
  const drop = page.getByRole("button", { name: /Drop files or browse/ });
  await drop.dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
  await page.getByLabel("Type for desk-call.txt").selectOption("discussion");
  await page.getByLabel("Usage rights").selectOption("owned");
  await page.getByLabel("Author or speaker").fill("Synthetic desk");
  await page.getByRole("button", { name: "Pin 8 files" }).click();
  const pins = page.getByRole("list", { name: "Pinned material" });
  await expect(pins.getByRole("listitem")).toHaveCount(7, { timeout: 30000 });
  await expect(page.getByText("7 files pinned. Review 1 remaining below.")).toBeVisible();
  await page.getByLabel("Author or speaker").fill("Another desk");
  await page.getByRole("button", { name: "Pin 1 file", exact: true }).click();
  await expect(pins.getByRole("listitem")).toHaveCount(8);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  const stored = await (await request.get(`/api/evidence/${bodies[0]!.id}`)).json();
  expect(stored).toMatchObject({
    kind: "discussion",
    author: "Synthetic desk",
    capture_method: "user_upload",
  });
  await page.getByRole("button", { name: "Move desk-call.txt up", exact: true }).click();
  await expect(pins.getByRole("listitem").nth(6)).toContainText("desk-call.txt");
  await page.reload();
  await expect(pins.getByRole("listitem").nth(6)).toContainText("desk-call.txt");
  await expect(pins.locator("img")).toHaveCount(6);
  await page.screenshot({ path: info.outputPath("desk-with-sources.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("slider", { name: "Thinking effort", exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("desk-phone.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Unpin desk-call.txt", exact: true }).click();
  await expect(pins.getByRole("listitem")).toHaveCount(7);
});

test("the methodology exposes commission, park and editorial paths on desktop and phone", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1380, height: 1000 });
  await page.goto("/");
  await page.getByRole("link", { name: "Methodology", exact: true }).click();
  await expect(page).toHaveURL(/view=methodology/);
  const graph = page.getByRole("group", { name: "Research desk workflow" });
  const detail = page.locator("#method-detail");
  await expect(detail).toContainText("Your working sentence");
  await expect(graph.getByRole("button")).toHaveCount(9);
  await graph
    .getByRole("button", { name: /Parked study/ })
    .filter({ hasText: "Parked study" })
    .first()
    .click();
  await expect(detail).toContainText("No researcher assignment is issued");
  await graph
    .getByRole("button", { name: /Editorial judgment/ })
    .filter({ hasText: "You · optional" })
    .click();
  await expect(detail).toContainText("review setting");
  await graph
    .getByRole("button", { name: /Your working sentence/ })
    .filter({ hasText: "You" })
    .click();
  await page.getByRole("button", { name: "Refinancing exposure" }).click();
  await expect(page.getByText(/Group companies by next debt maturity/)).toBeVisible();
  await page.screenshot({ path: info.outputPath("methodology.png"), fullPage: true });
  await page.reload();
  await expect(page.getByRole("link", { name: "Methodology", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const read = graph.getByRole("button", { name: /^Lead Lead’s first reading/ });
  await read.focus();
  await read.press("Enter");
  await expect(detail.getByRole("heading")).toHaveText("Lead’s first reading");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("methodology-phone.png"), fullPage: true });
  await page.getByRole("link", { name: "Open research desk" }).click();
  await expect(page.getByRole("heading", { name: "Add material" })).toBeVisible();
});
