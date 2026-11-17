import { writeFile } from "node:fs/promises";
import { expect, test } from "./fixtures";
import type { Workflow } from "../src/lib/workflow";

// Observational measurement, not a machine-dependent pass/fail latency gate.
test("measure 128-node canvas interaction and verify fit, movement, and history", async ({
  page,
  request,
}, testInfo) => {
  const workflow: Workflow = {
    schema_version: "0.2",
    name: "128-step authoring measurement",
    start_node: "step-0",
    nodes: Array.from({ length: 128 }, (_, index) => ({
      id: `step-${index}`,
      kind: index === 127 ? "finish" : index % 5 === 4 ? "review" : "note",
      label: `Research step ${index + 1}`,
      instructions: "Synthetic workflow for editor interaction measurements.",
      position: { x: 60 + (index % 8) * 290, y: 60 + Math.floor(index / 8) * 200 },
      ...(index > 0 && index % 5 !== 4 && index !== 127
        ? {
            inputs: {
              text: {
                source: "output" as const,
                node_id: `step-${index - 1}`,
                port: (index - 1) % 5 === 4 ? "decision" : "text",
              },
            },
          }
        : {}),
    })),
    edges: Array.from({ length: 127 }, (_, index) => ({
      source: `step-${index}`,
      target: `step-${index + 1}`,
      source_port: "next",
      target_port: "in",
    })),
  };
  const saved = await request.post("/api/revisions", { data: workflow });
  expect(saved.status(), await saved.text()).toBe(201);
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.goto(`/?revision=${(await saved.json()).id}`);
  await expect(page.getByRole("button", { name: "Run workflow" })).toBeEnabled();
  await expect(page.locator(".graph-node")).toHaveCount(128);
  await page.getByRole("button", { name: "Fit workflow to view" }).click();
  const fit = await page.locator(".canvas").evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect();
    return [...canvas.querySelectorAll(".graph-group")].every((node) => {
      const box = node.getBoundingClientRect();
      return (
        box.left >= bounds.left &&
        box.right <= bounds.right &&
        box.top >= bounds.top &&
        box.bottom <= bounds.bottom
      );
    });
  });
  expect(fit).toBe(true);
  await page.getByRole("button", { name: "Reset view", exact: true }).click();
  const metrics = await page.evaluate(async () => {
    const node = document.getElementById("workflow-node-step-0")!;
    const canvas = document.querySelector(".canvas")!;
    node.focus();
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await nextFrame();
    const measure = async (action: () => void) => {
      const samples: number[] = [];
      for (let index = 0; index < 35; index++) {
        const start = performance.now();
        action();
        await nextFrame();
        if (index >= 5) samples.push(performance.now() - start);
      }
      const ordered = [...samples].sort((a, b) => a - b);
      return {
        samples,
        median_ms: ordered[Math.floor(ordered.length / 2)],
        p95_ms: ordered[Math.ceil(ordered.length * 0.95) - 1],
        max_ms: ordered.at(-1),
      };
    };
    const nudge = await measure(() =>
      node.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    const pan = await measure(() =>
      canvas.dispatchEvent(
        new WheelEvent("wheel", { deltaX: 4, deltaY: 2, bubbles: true, cancelable: true }),
      ),
    );
    const zoom = await measure(() =>
      canvas.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -1, ctrlKey: true, bubbles: true, cancelable: true }),
      ),
    );
    return {
      user_agent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight },
      nodes: 128,
      samples_per_action: 30,
      method:
        "Synthetic DOM events through production SDK handlers; event dispatch to next animation-frame callback, after five warm-up iterations. Includes frame scheduling; not end-to-end input-to-display latency.",
      nudge,
      pan,
      zoom,
    };
  });
  const group = page.locator('[data-node-id="step-0"]');
  await expect(group).toHaveCSS("left", "410px");
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  await expect(group).toHaveCSS("left", "60px");
  await page.getByRole("button", { name: "Redo last edit", exact: true }).click();
  await expect(group).toHaveCSS("left", "410px");
  await page.getByRole("button", { name: "Fit workflow to view" }).click();
  await page.screenshot({ path: testInfo.outputPath("large-graph.png"), fullPage: true });
  const path = testInfo.outputPath("interaction-metrics.json");
  await writeFile(path, JSON.stringify(metrics, null, 2));
  await testInfo.attach("128-node interaction metrics", { path, contentType: "application/json" });
  console.log(
    JSON.stringify({
      mode: process.env.CI ? "production" : "development",
      nodes: 128,
      nudge: metrics.nudge.median_ms,
      nudge_p95: metrics.nudge.p95_ms,
      pan: metrics.pan.median_ms,
      pan_p95: metrics.pan.p95_ms,
      zoom: metrics.zoom.median_ms,
      zoom_p95: metrics.zoom.p95_ms,
    }),
  );
});
