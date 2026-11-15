import { test as base, expect, type APIRequestContext } from "@playwright/test";

type OwnerFixture = {
  state: Awaited<ReturnType<APIRequestContext["storageState"]>>;
  csrf: string;
  prefix: string;
};

export const test = base.extend<{ ownerSession: OwnerFixture }>({
  ownerSession: async ({ playwright, baseURL }, provide) => {
    const password = process.env.RESEARCHCHAIN_TEST_OWNER_PASSWORD;
    if (!password) throw new Error("Run the isolated browser-test runner.");
    const client = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { Origin: baseURL! },
    });
    try {
      const response = await client.post("/api/access/login", { data: { password } });
      expect(response.status()).toBe(200);
      const { session } = await response.json();
      await provide({
        state: await client.storageState(),
        csrf: session.csrf_token,
        prefix: `researchchain.owner.${session.workspace_id}.${session.owner_id}`,
      });
      await client
        .post("/api/access/logout", {
          headers: { "X-ResearchChain-CSRF": session.csrf_token },
        })
        .catch(() => undefined);
    } finally {
      await client.dispose();
    }
  },
  storageState: async ({ ownerSession }, provide) => {
    await provide(ownerSession.state);
  },
  request: async ({ playwright, baseURL, ownerSession }, provide) => {
    const client = await playwright.request.newContext({
      baseURL,
      storageState: ownerSession.state,
      extraHTTPHeaders: { Origin: baseURL!, "X-ResearchChain-CSRF": ownerSession.csrf },
    });
    try {
      await provide(client);
    } finally {
      await client.dispose();
    }
  },
});

export { expect };
export type { APIRequestContext, Page, Locator } from "@playwright/test";
