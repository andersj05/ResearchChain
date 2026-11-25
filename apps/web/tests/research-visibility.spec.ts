import { expect, test, type Page } from "./fixtures";

type Visibility = "visible" | "hidden";

async function observeReads(page: Page, initial: Visibility = "visible") {
  await page.clock.install();
  await page.addInitScript((initial) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: initial });
    const reads: string[] = [];
    Reflect.set(window, "deskPollReads", reads);
    const fetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      const path = new URL(input instanceof Request ? input.url : input, location.href).pathname;
      if (method === "GET" && path.startsWith("/api/")) reads.push(path);
      return fetch(input, init);
    };
  }, initial);
}

async function pauseClock(page: Page) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1000);
}

function readsFor(page: Page, ...paths: string[]) {
  return page.evaluate((paths) => {
    const reads = Reflect.get(window, "deskPollReads") as string[];
    return paths.map((path) => reads.filter((read) => read === path).length);
  }, paths);
}

async function changeVisibility(page: Page, state: Visibility) {
  await page.evaluate((state) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

function pendingDecision(id: string, title: string) {
  return {
    items: [
      {
        id,
        study_title: title,
        workflow_name: "Research session",
        created_at: new Date().toISOString(),
        reviews: [
          {
            node_id: "working_sentence",
            interrupt_id: id,
            question: "Which synthetic observation should guide the first reading?",
          },
        ],
      },
    ],
    has_more: false,
  };
}

test("Recent research and the decision summary pause on hide and refresh on show", async ({
  page,
}) => {
  const recentPath = "/api/research-sessions";
  const decisionPath = "/api/runs/reviews";
  const id = crypto.randomUUID();
  let recent = 0;
  let decisions = 0;
  await observeReads(page);
  await page.route(`**${recentPath}`, (route) =>
    route.fulfill({
      json: [
        {
          id,
          study_title: `Recent study ${++recent}`,
          workflow_name: "Research session",
          status: "running",
          created_at: new Date().toISOString(),
        },
      ],
    }),
  );
  await page.route(`**${decisionPath}?*`, (route) =>
    route.fulfill({ json: pendingDecision(id, `Pending decision ${++decisions}`) }),
  );
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Recent study 1" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pending decision 1" })).toBeVisible();

  await pauseClock(page);
  await changeVisibility(page, "hidden");
  await page.clock.fastForward(20_000);
  expect(await readsFor(page, recentPath, decisionPath)).toEqual([1, 1]);
  await changeVisibility(page, "visible");
  await expect(page.getByRole("link", { name: "Recent study 2" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pending decision 2" })).toBeVisible();
  expect(await readsFor(page, recentPath, decisionPath)).toEqual([2, 2]);
});

test("Decisions waits for an initially hidden tab to become visible", async ({ page }) => {
  const path = "/api/runs/reviews";
  const id = crypto.randomUUID();
  await observeReads(page, "hidden");
  await page.route(`**${path}?*`, (route) =>
    route.fulfill({ json: pendingDecision(id, "Synthetic decision ready to review") }),
  );
  await page.goto("/?view=research&inbox=1");
  await expect(page.getByRole("heading", { name: "Study decisions" })).toBeVisible();
  await pauseClock(page);
  await page.clock.fastForward(20_000);
  expect(await readsFor(page, path)).toEqual([0]);

  await changeVisibility(page, "visible");
  await expect(
    page.getByRole("heading", { name: "Synthetic decision ready to review" }),
  ).toBeVisible();
  expect(await readsFor(page, path)).toEqual([1]);
});

test("a stale study response cannot overwrite the first refresh after show", async ({ page }) => {
  const id = crypto.randomUUID();
  const path = `/api/runs/${id}`;
  const release = Promise.withResolvers<void>();
  const currentTitle = "Study refreshed in the visible tab";
  let requests = 0;
  await observeReads(page);
  await page.route(`**${path}`, async (route) => {
    const read = ++requests;
    if (read === 2) await release.promise;
    await route.fulfill({
      headers: { "x-synthetic-read": String(read) },
      json: {
        id,
        revision_id: id,
        revision_number: 1,
        workflow_name: "Research session",
        brief: read === 1 ? "Initial study" : read === 2 ? "Stale hidden study" : currentTitle,
        status: read < 3 ? "running" : "completed",
        created_at: new Date().toISOString(),
        workflow: { nodes: [], budgets: { max_active_seconds: 1800 } },
        events: [],
        artifacts: [],
        execution_pending: false,
        research_manifest: {
          tool_config: { session: "brief-led-1" },
          evidence: [],
          settings: { model: "test-model", limits: { max_model_calls: 25 } },
        },
      },
    });
  });

  try {
    await page.goto(`/?session=${id}`);
    await expect(page.getByRole("heading", { name: "Initial study" })).toBeVisible();
    await pauseClock(page);
    await page.clock.fastForward(1300);
    await expect.poll(() => requests).toBe(2);
    await changeVisibility(page, "hidden");
    // Advance past the study's poll interval while keeping the held request inside its timeout.
    await page.clock.fastForward(5000);
    expect(await readsFor(page, path)).toEqual([2]);

    await changeVisibility(page, "visible");
    const accessRefresh = page.waitForResponse((response) =>
      response.url().endsWith("/api/access/status"),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await (await accessRefresh).finished();
    await expect(page.getByRole("heading", { name: currentTitle })).toBeVisible();
    const stale = page.waitForResponse(
      (response) => response.url().endsWith(path) && response.headers()["x-synthetic-read"] === "2",
      { timeout: 5000 },
    );
    release.resolve();
    await (await stale).finished();
    await page.clock.fastForward(5000);
    await expect(page.getByRole("heading", { name: currentTitle })).toBeVisible();
    expect(await readsFor(page, path)).toEqual([3]);
  } finally {
    release.resolve();
  }
});
