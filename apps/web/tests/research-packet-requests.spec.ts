import { blankResearchBrief } from "../src/lib/research-sessions";
import { expect, test, type Page } from "./fixtures";
import type { Request } from "@playwright/test";

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
    await packet.getByRole("button", { name: "Unpin Saved reference 3", exact: true }).click();
    await expect(rows).toHaveCount(pinned.length - 1);
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

function packetReference(title: string) {
  return {
    id: crypto.randomUUID(),
    title,
    kind: "link",
    availability: "reference_only",
    representation: "original",
    source_url: "https://example.org/packet-reference",
  };
}

async function restorePacket(page: Page, ownerPrefix: string, ids: string[]) {
  await page.addInitScript(({ key, saved }) => sessionStorage.setItem(key, JSON.stringify(saved)), {
    key: `${ownerPrefix}.research-brief.new`,
    saved: {
      draft: { ...blankResearchBrief, evidence_ids: ids },
      pending: null,
      awaitingModelCatalog: true,
    },
  });
}

test("keep the loaded packet ready during selection edits and reread removed records on return", async ({
  page,
  ownerSession,
}) => {
  const pinned = Array.from({ length: 9 }, (_, index) =>
    packetReference(`Saved packet source ${index + 1}`),
  );
  const fresh = packetReference("Added material");
  const sources = [...pinned, fresh];
  await restorePacket(
    page,
    ownerSession.prefix,
    pinned.map(({ id }) => id),
  );
  await page.route("**/api/evidence?*", (route) =>
    route.fulfill({ json: { items: [fresh], total: 1 } }),
  );
  const read: Record<"initial" | "editing" | "recheck" | "restore", string[]> = {
    initial: [],
    editing: [],
    recheck: [],
    restore: [],
  };
  let phase: keyof typeof read = "initial";
  const releaseRecheck = Promise.withResolvers<void>();
  let maximum = 0;
  const pending = new Set<Request>();
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/evidence/")) return;
    pending.add(request);
    maximum = Math.max(maximum, pending.size);
  });
  page.on("requestfinished", (request) => pending.delete(request));
  page.on("requestfailed", (request) => pending.delete(request));
  await page.route("**/api/evidence/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const record = sources.find((item) => item.id === id);
    if (!record) return route.fulfill({ status: 404 });
    const started = phase;
    read[started].push(id);
    if (started === "recheck") await releaseRecheck.promise;
    const title =
      started === "restore"
        ? `Restored ${record.title}`
        : started === "recheck"
          ? `Earlier response for ${record.title}`
          : record.title;
    await route.fulfill({ json: { ...record, title } });
  });

  try {
    await page.goto("/");
    const packet = page.getByRole("list", { name: "Pinned material", exact: true });
    const rows = packet.getByRole("listitem");
    const start = page.getByRole("button", { name: "Ask the lead for a first reading" });
    await expect(start).toBeEnabled();
    await expect(rows.last()).toContainText(pinned.at(-1)!.title);
    expect(read.initial).toHaveLength(pinned.length);

    phase = "editing";
    await packet.getByRole("button", { name: `Unpin ${pinned[1]!.title}`, exact: true }).click();
    await expect(rows).toHaveCount(pinned.length - 1);
    await expect(rows.first()).toContainText(pinned[0]!.title);
    await expect(rows.last()).toContainText(pinned.at(-1)!.title);
    await expect(start).toBeEnabled();
    await page.getByRole("checkbox", { name: `${fresh.title} Link only`, exact: true }).check();
    await expect(rows.last()).toContainText(fresh.title);
    await expect(start).toBeEnabled();
    expect(read.editing).toEqual([]);

    phase = "recheck";
    await page.getByRole("link", { name: "Studies", exact: true }).click();
    await page.getByRole("link", { name: "Return to study setup", exact: true }).click();
    await expect.poll(() => read.recheck.length).toBe(6);
    await expect(start).toBeEnabled();
    await expect(rows.first()).toContainText(pinned[0]!.title);

    phase = "restore";
    await page.getByRole("button", { name: "Unpin all", exact: true }).click();
    await page.getByRole("button", { name: "Undo unpin all", exact: true }).click();
    await expect(rows).toHaveCount(pinned.length);
    await expect(start).toBeDisabled();
    expect(read.restore).toEqual([]);
    releaseRecheck.resolve();
    await expect(rows.first()).toContainText(`Restored ${pinned[0]!.title}`);
    await expect(rows.last()).toContainText(`Restored ${fresh.title}`);
    await expect(start).toBeEnabled();
    expect(read.restore.toSorted()).toEqual(
      [pinned[0]!, ...pinned.slice(2), fresh].map(({ id }) => id).toSorted(),
    );
    expect(maximum).toBe(6);
  } finally {
    releaseRecheck.resolve();
  }
});

test("reload exact packet details after signing in to the retained draft", async ({
  page,
  ownerSession,
}) => {
  const sources = [packetReference("First source"), packetReference("Second source")];
  await restorePacket(
    page,
    ownerSession.prefix,
    sources.map(({ id }) => id),
  );
  const olderRequests: string[] = [];
  const newRequests: string[] = [];
  const releaseOlder = Promise.withResolvers<void>();
  const releaseNew = Promise.withResolvers<void>();
  let signingIn = false;
  await page.route("**/api/evidence/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const record = sources.find((item) => item.id === id);
    if (!record) return route.fulfill({ status: 404 });
    if (!signingIn) {
      olderRequests.push(id);
      if (record === sources[1]) await releaseOlder.promise;
      // Revocation can cancel the old response before the fixture releases it.
      await route.fulfill({ json: { ...record, title: `Old ${record.title}` } }).catch(() => {});
      return;
    }
    newRequests.push(id);
    await releaseNew.promise;
    await route.fulfill({ json: { ...record, title: `Fresh ${record.title}` } });
  });

  try {
    await page.goto("/");
    const title = page.getByRole("textbox", { name: "Study title (optional)", exact: true });
    const packet = page.getByRole("list", { name: "Pinned material", exact: true });
    await title.fill("Keep this draft through sign-in");
    await expect
      .poll(() => olderRequests.toSorted())
      .toEqual(sources.map(({ id }) => id).toSorted());
    await expect(packet).toContainText("Old First source");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sign in again", exact: true })).toBeVisible();
    await expect(title).toBeHidden();
    expect(newRequests).toEqual([]);

    signingIn = true;
    const password = process.env.RESEARCHCHAIN_TEST_OWNER_PASSWORD!;
    await page.getByLabel("Owner password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(title).toHaveValue("Keep this draft through sign-in");
    await expect.poll(() => newRequests.toSorted()).toEqual(sources.map(({ id }) => id).toSorted());
    await expect(packet.getByText(/^Old /)).toHaveCount(0);
    releaseNew.resolve();
    await expect(packet).toContainText("Fresh Second source");
    await expect(packet).toContainText("Fresh First source");
    expect(newRequests.toSorted()).toEqual(sources.map(({ id }) => id).toSorted());
    releaseOlder.resolve();
    await expect(packet.getByText(/^Old /)).toHaveCount(0);
  } finally {
    releaseOlder.resolve();
    releaseNew.resolve();
  }
});
