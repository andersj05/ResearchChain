import { expect, test } from "./fixtures";

for (const width of [390, 1440]) {
  for (const route of ["fresh draft", "same baseline", "previous study link"]) {
    const sameBaseline = route !== "fresh draft";
    const direct = route === "previous study link";

    test(`keep the staged setup when revisiting from ${route} at ${width}px`, async ({
      page,
      context,
    }) => {
      const id = crypto.randomUUID();
      const title = "Synthetic archived rates study";
      const contextText = "Archived synthetic context.";
      const currentDraftContext = "Edited context for the open draft.";
      const revisitUrl = `/?fromSession=${id}`;
      const readerUrl = `/?session=${id}`;
      const initialUrl = sameBaseline ? revisitUrl : "/";
      const run = {
        id,
        revision_id: crypto.randomUUID(),
        revision_number: 1,
        workflow_name: "Research session",
        study_title: title,
        status: "completed",
        created_at: "2026-11-24T13:04:00Z",
      };
      await page.route("**/api/runs/search?*", (route) =>
        route.fulfill({ json: { items: [{ run, brief_excerpt: contextText }], has_more: false } }),
      );
      await page.route(`**/api/runs/${id}`, (route) =>
        route.fulfill({
          json: {
            ...run,
            brief: contextText,
            execution_pending: false,
            checkpoint_id: null,
            workflow: { nodes: [], edges: [] },
            events: [],
            artifacts: [],
            evidence_ids: [],
            model_attempts: [],
            research_manifest: {
              tool_config: { session: "brief-led-1" },
              evidence: [],
              settings: { model: "test-model", limits: { max_model_calls: 25 } },
            },
          },
        }),
      );
      await context.route(`**/api/research-sessions/${id}/setup`, (route) =>
        route.fulfill({
          json: {
            title,
            start_from_sources: true,
            brief: contextText,
            style_excerpt: "",
            model: "test-model",
            reasoning_effort: "medium",
            verbosity: "low",
            evidence_ids: [],
            max_agents: 3,
            max_passes: 6,
            max_active_seconds: 1800,
            max_input_bytes: 8_000_000,
            web_search: false,
            review_mode: "when_needed",
          },
        }),
      );
      const launches: string[] = [];
      await context.route("**/api/research-sessions", (route) => {
        if (route.request().method() === "GET") return route.fulfill({ json: [] });
        launches.push(route.request().method());
        return route.abort();
      });
      await context.route("**/api/evidence?*", (route) =>
        route.fulfill({ json: { items: [], total: 0 } }),
      );
      await page.setViewportSize({ width, height: 844 });
      await page.goto(initialUrl);
      const leadContext = page.getByLabel("Context for the lead (optional)", { exact: true });
      if (sameBaseline) await expect(leadContext).toHaveValue(contextText);
      await leadContext.fill(currentDraftContext);
      const documentToken = crypto.randomUUID();
      await page.evaluate(
        (token) => Reflect.set(window, "syntheticRevisitToken", token),
        documentToken,
      );
      await page.getByLabel("Usage rights").selectOption("owned");
      await page.getByLabel("Source files").setInputFiles({
        name: "staged-rates.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("A synthetic rates note awaiting an explicit pin."),
      });
      const queue = page.getByRole("list", { name: "Files to pin" });
      const queuedTitle = queue.getByLabel("Packet title for staged-rates.txt");
      await queuedTitle.fill("Edited staged rates note");
      await expect(queuedTitle).toHaveValue("Edited staged rates note");
      const result = page
        .getByRole("list", { name: "Saved studies" })
        .getByRole("link", { name: new RegExp(title) });
      const comparison = page.getByText("Compare with previous setup", { exact: true });
      if (direct) {
        await comparison.click();
        await expect(
          page.getByRole("region", { name: "Context for the lead", exact: true }),
        ).toContainText(currentDraftContext);
        await page.getByRole("link", { name: "previous study", exact: true }).press("Enter");
      } else {
        await page.getByRole("link", { name: "Studies", exact: true }).press("Enter");
        await result.press("Enter");
      }
      const reader = page.getByRole("heading", { name: title, exact: true });
      await expect(reader).toBeVisible();
      await expect(queue).toBeHidden();
      expect(await page.evaluate(() => Reflect.get(window, "syntheticRevisitToken"))).toBe(
        documentToken,
      );
      await expect(reader).toBeFocused();
      const revisit = page.getByRole("link", {
        name: sameBaseline ? "Revisit material" : "Revisit material (new tab)",
        exact: true,
      });
      await expect(revisit).toHaveAttribute("href", `?fromSession=${id}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (sameBaseline) {
        await expect(revisit).not.toHaveAttribute("target", "_blank");
        await revisit.press("Enter");
        await expect(page).toHaveURL(revisitUrl);
        await expect(
          page.getByRole("heading", { name: "Revisit material", exact: true }),
        ).toBeFocused();
      } else {
        await expect(revisit).toHaveAttribute("target", "_blank");
        await expect(revisit).toHaveAttribute("rel", "noopener");
        const opened = context.waitForEvent("page");
        await revisit.press("Enter");
        const otherTab = await opened;
        try {
          await otherTab.setViewportSize({ width, height: 844 });
          await expect(otherTab).toHaveURL(revisitUrl);
          await expect(
            otherTab.getByLabel("Context for the lead (optional)", { exact: true }),
          ).toHaveValue(contextText);
          await expect(otherTab.getByRole("list", { name: "Files to pin" })).toHaveCount(0);
          await expect(otherTab.getByRole("link", { name: "previous study" })).toHaveAttribute(
            "href",
            readerUrl,
          );
        } finally {
          await otherTab.close();
        }
        await page.bringToFront();
        await expect(page).toHaveURL(readerUrl);
        await page.goBack();
        await expect(result).toBeFocused();
        await page.goBack();
        await expect(page).toHaveURL(initialUrl);
      }
      await expect(leadContext).toHaveValue(currentDraftContext);
      await expect(queuedTitle).toHaveValue("Edited staged rates note");
      if (direct) {
        await expect(page.locator("details").filter({ has: comparison })).toHaveAttribute(
          "open",
          "",
        );
        const home = page.getByRole("link", { name: "Research desk (new tab)", exact: true });
        const opened = context.waitForEvent("page");
        await home.press("Enter");
        const fresh = await opened;
        try {
          await expect(
            fresh.getByRole("heading", { name: "New study", exact: true }),
          ).toBeVisible();
          await expect(fresh.getByRole("list", { name: "Files to pin" })).toHaveCount(0);
        } finally {
          await fresh.close();
        }
        await page.bringToFront();
        await expect(page).toHaveURL(revisitUrl);
        await expect(queuedTitle).toHaveValue("Edited staged rates note");
      }
      expect(await page.evaluate(() => Reflect.get(window, "syntheticRevisitToken"))).toBe(
        documentToken,
      );
      expect(launches).toEqual([]);
    });
  }
}
