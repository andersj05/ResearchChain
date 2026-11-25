import { blankResearchBrief } from "../src/lib/research-sessions";
import { expect, test } from "./fixtures";

test("show restored study sources as they arrive and keep their requests stable while editing", async ({
  page,
  ownerSession,
}) => {
  const sources = Array.from({ length: 41 }, (_, index) => ({
    id: crypto.randomUUID(),
    title: `Saved reference ${index + 1}`,
    kind: "link",
    availability: "reference_only",
    representation: "original",
    source_url: `https://example.org/reference-${index + 1}`,
  }));
  const pinned = sources.slice(0, 40);
  const missing = pinned.at(-1)!;
  const slow = pinned
    .toSorted((a, b) => a.id.localeCompare(b.id))
    .find((item) => item !== missing)!;
  const slowIndex = pinned.indexOf(slow);
  const fresh = sources.at(-1)!;
  await page.addInitScript(({ key, saved }) => sessionStorage.setItem(key, JSON.stringify(saved)), {
    key: `${ownerSession.prefix}.research-brief.new`,
    saved: {
      draft: { ...blankResearchBrief, evidence_ids: pinned.map(({ id }) => id) },
      pending: null,
      awaitingModelCatalog: true,
    },
  });
  await page.route("**/api/evidence?*", (route) =>
    route.fulfill({ json: { items: sources, total: sources.length } }),
  );
  const detailReads: string[] = [];
  const releaseSlow = Promise.withResolvers<void>();
  const releaseRetry = Promise.withResolvers<void>();
  let mayRetryMissing = false;
  await page.route("**/api/evidence/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    detailReads.push(id);
    const record = pinned.find((item) => item.id === id);
    if (!record || (record === missing && !mayRetryMissing))
      return route.fulfill({ status: 503, json: { detail: "Source details are unavailable." } });
    if (record === slow) await releaseSlow.promise;
    if (record === missing) await releaseRetry.promise;
    return route.fulfill({ json: record });
  });

  await page.goto("/");
  const packet = page.getByRole("list", { name: "Pinned material" });
  const rows = packet.getByRole("listitem");
  const retry = page.getByRole("button", { name: "Retry source details" });
  try {
    await expect(packet.getByRole("link", { name: /^Saved reference \d+ Link only$/ })).toHaveCount(
      pinned.length - 2,
    );
    await expect(rows.nth(slowIndex)).toContainText("Loading source details…");
    await expect(retry).toBeVisible();
  } finally {
    releaseSlow.resolve();
  }
  await expect(rows.nth(slowIndex)).toContainText(slow.title);
  expect(new Set(detailReads)).toEqual(new Set(pinned.map(({ id }) => id)));
  expect(detailReads).toHaveLength(pinned.length);
  const initialReads = detailReads.length;

  await packet.getByRole("button", { name: "Move Saved reference 2 up", exact: true }).click();
  await expect(rows.first()).toContainText("Saved reference 2");
  await expect(rows.nth(1)).toContainText("Saved reference 1");
  await expect(retry).toBeVisible();
  expect(detailReads).toHaveLength(initialReads);

  mayRetryMissing = true;
  const pendingRetry = page.waitForRequest(`**/api/evidence/${missing.id}`);
  try {
    await retry.click();
    await pendingRetry;
    await packet.getByRole("button", { name: "Move Saved reference 2 down", exact: true }).click();
    await expect(rows.first()).toContainText("Saved reference 1");
    await expect(rows.nth(1)).toContainText("Saved reference 2");
  } finally {
    releaseRetry.resolve();
  }
  await expect(rows.last()).toContainText(missing.title);
  await expect(retry).toHaveCount(0);
  expect(detailReads.slice(initialReads)).toEqual([missing.id]);

  await page.getByRole("checkbox", { name: `${fresh.title} Link only`, exact: true }).check();
  await expect(rows.last()).toContainText(fresh.title);
  await expect(rows.first()).toContainText("Saved reference 1");
  expect(detailReads.slice(initialReads)).toEqual([missing.id]);
});
