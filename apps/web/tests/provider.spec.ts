import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

for (const width of [1280, 390]) {
  test(`ChatGPT plan sign-in on ${width}px screen`, async ({ page }, testInfo) => {
    const python = resolve(
      "../api/.venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    );
    const child = spawn(python, ["-u", resolve("../api/tests/chatgpt_browser_fixture.py")], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exit = new Promise<number | null>((resolve) => child.once("exit", resolve));
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    try {
      const entry = await new Promise<string>((resolve, reject) => {
        let output = "";
        const timer = setTimeout(() => reject(new Error("Sign-in fixture did not start")), 15000);
        child.on("error", reject);
        child.stdout.on("data", (chunk) => {
          output += chunk.toString();
          const match = output.match(
            /Continue with ChatGPT: (http:\/\/127\.0\.0\.1:\d+\/start\/\S+)/,
          );
          if (match?.[1]) {
            clearTimeout(timer);
            resolve(match[1]);
          }
        });
      });
      await page.setViewportSize({ width, height: 850 });
      // Fetch the real local POST without following its redirect. Simulate the
      // provider at this boundary so no browser test contacts a real account.
      await page.route("**/continue/**", async (route) => {
        const response = await route.fetch({ maxRedirects: 0 });
        expect(response.status()).toBe(303);
        const authorization = new URL(response.headers()["location"]!);
        expect(authorization.origin).toBe("https://auth.openai.com");
        expect(authorization.searchParams.get("client_id")).toBe("dynamic_agent_client");
        expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
        expect(authorization.searchParams.get("scope")).toContain("chatgpt.tokens.use.direct");
        const callback = new URL(authorization.searchParams.get("redirect_uri")!);
        callback.searchParams.set("state", authorization.searchParams.get("state")!);
        callback.searchParams.set("client_id", "oaiapp_synthetic_test_registration");
        callback.searchParams.set("code", "synthetic-code");
        await route.fulfill({ status: 303, headers: { location: callback.href } });
      });
      await page.goto(entry);
      await expect(page.getByRole("heading", { name: "Use your ChatGPT plan" })).toBeVisible();
      await expect(page.getByText(/Leave credit use disabled/)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath("chatgpt-signin.png"), fullPage: true });
      await page.getByRole("button", { name: "Continue with ChatGPT" }).click();
      await expect(
        page.getByRole("heading", { name: "You're using your ChatGPT plan" }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "Manage usage", exact: true })).toHaveAttribute(
        "href",
        "https://chatgpt.com/settings/usage",
      );
      await page.screenshot({ path: testInfo.outputPath("chatgpt-connected.png"), fullPage: true });
      expect(await exit, stderr).toBe(0);
    } finally {
      if (child.exitCode === null) child.kill();
    }
  });
}
