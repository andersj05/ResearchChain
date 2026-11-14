import { defineConfig, devices } from "@playwright/test";

if (!process.env.DATABASE_SCHEMA?.startsWith("e2e_")) {
  throw new Error("Run pnpm test:e2e from the repository root to isolate browser-test data.");
}

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command:
        "uv run --project ../api uvicorn researchchain.main:app --host 127.0.0.1 --port 8000",
      url: "http://127.0.0.1:8000/api/health",
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: process.env.CI ? "pnpm start" : "pnpm dev",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
