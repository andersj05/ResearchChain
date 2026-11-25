import { defineConfig, devices } from "@playwright/test";

if (!process.env.DATABASE_SCHEMA?.startsWith("e2e_")) {
  throw new Error("Run pnpm test:e2e from the repository root to isolate browser-test data.");
}

const webPort = process.env.RESEARCHCHAIN_BROWSER_WEB_PORT;
const apiPort = process.env.RESEARCHCHAIN_BROWSER_API_PORT;
if (!webPort || !apiPort) throw new Error("Run the isolated browser-test runner.");

const webOrigin = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: webOrigin, trace: "retain-on-failure" },
  projects: [
    {
      name: "usage",
      testMatch: /usage\.spec\.ts/,
      dependencies: ["retention"],
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "retention",
      testMatch: /retention\.spec\.ts/,
      dependencies: ["workers"],
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testIgnore: /(access|workers|retention|signin|usage)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "workers",
      testMatch: /workers\.spec\.ts/,
      dependencies: ["access"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "signin",
      testMatch: /signin\.spec\.ts/,
      dependencies: ["chromium"],
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "access",
      testMatch: /access\.spec\.ts/,
      dependencies: ["signin"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: `uv run --project ../api uvicorn --app-dir ../api/tests research_browser_fixture:app --host 127.0.0.1 --port ${apiPort}`,
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: process.env.CI ? "pnpm start" : `pnpm dev --port ${webPort}`,
      url: webOrigin,
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
