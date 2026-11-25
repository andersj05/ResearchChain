import type { RunSnapshot } from "../src/lib/workflow";
import { expect, test } from "./fixtures";

type Review = NonNullable<RunSnapshot["review"]>;
type Submission = {
  checkpoint_id: string;
  interrupt_id: string;
  decision: string;
  feedback: string;
};

const cases = [
  {
    kind: "first reading",
    path: "root/working_sentence",
    region: "Source-led investigation",
    draftLabel: "Your working sentence",
    submitLabel: "Assign research",
  },
  {
    kind: "expert consultation",
    path: "root/team/lead-1/turn-1",
    region: "Demand requests your perspective",
    draftLabel: "Your perspective",
    submitLabel: "Send perspective to lead",
  },
  {
    kind: "editorial review",
    path: "root/judgment",
    region: "Your judgment",
    draftLabel: "Direction for the editor",
    submitLabel: "Continue to report",
  },
];

function consultation(title: string, path: string): Review {
  const question = `Which series should guide the ${title.toLowerCase()} check?`;
  return {
    node_id: "team",
    path,
    interrupt_id: crypto.randomUUID(),
    question,
    perspective: {
      lead_title: title,
      action_path: path,
      question,
      thesis: "The release timing could change the conclusion.",
      options: [],
      worker_paths: [],
    },
  };
}

for (const scenario of cases) {
  test(`retries a conflicted ${scenario.kind} beside the original draft on a phone`, async ({
    page,
  }) => {
    const runId = crypto.randomUUID();
    const initialCheckpoint = crypto.randomUUID();
    const currentCheckpoint = crypto.randomUUID();
    const discovery = scenario.kind === "first reading";
    const expert = scenario.kind === "expert consultation";
    const primary: Review = expert
      ? consultation("Demand", scenario.path)
      : {
          node_id: discovery ? "working_sentence" : "judgment",
          path: scenario.path,
          interrupt_id: crypto.randomUUID(),
          question: "Which observation should guide the next step?",
        };
    const other = expert ? [consultation("Supply", "root/team/lead-2/turn-1")] : [];
    const now = new Date().toISOString();
    const refresh = Promise.withResolvers<void>();
    const submitted: Submission[] = [];
    const draft = "Compare revisions in the two archived releases before drawing a conclusion.";

    await page.route(`**/api/runs/${runId}`, async (route) => {
      if (submitted.length === 1) await refresh.promise;
      const reviews = submitted.length < 2 ? [primary, ...other] : other;
      return route.fulfill({
        json: {
          id: runId,
          brief: "Check two synthetic vintage series.",
          created_at: now,
          status: reviews.length ? "paused" : "running",
          execution_pending: false,
          checkpoint_id: submitted.length ? currentCheckpoint : initialCheckpoint,
          review: reviews[0] ?? null,
          reviews,
          events: [],
          artifacts: [],
          evidence_ids: [],
          workflow: {
            nodes: expert
              ? [
                  {
                    id: "team",
                    config: { type: "research", team: { swarm: { lead_count: 2 } } },
                  },
                ]
              : [],
          },
          research_manifest: {
            settings: { model: "synthetic", limits: { max_model_calls: 30 } },
            evidence: [],
            tool_config: {
              session: "brief-led-1",
              ...(discovery ? { discovery_version: "discovery-1" } : {}),
            },
          },
          model_attempts: discovery
            ? [
                {
                  id: crypto.randomUUID(),
                  path: "root/discovery",
                  status: "completed",
                  model: "synthetic",
                  created_at: now,
                  result: {
                    limitations: [],
                    discovery: {
                      observation: "The two synthetic vintages differ.",
                      question: primary.question,
                      proposals: [],
                      citations: [],
                    },
                  },
                },
              ]
            : [],
        },
      });
    });
    await page.route(`**/api/runs/${runId}/resume`, (route) => {
      submitted.push(route.request().postDataJSON());
      return submitted.length === 1
        ? route.fulfill({
            status: 409,
            json: { detail: "This review is no longer current. Refresh the run before deciding." },
          })
        : route.fulfill({ status: 202, json: { run_id: runId } });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/?session=${runId}`);
    const region = page.getByRole("region", { name: scenario.region });
    const field = region.getByLabel(scenario.draftLabel);
    const submit = region.getByRole("button", { name: scenario.submitLabel });
    const error = region.getByRole("alert");
    const sibling = page.getByRole("region", { name: "Supply requests your perspective" });
    if (expert) await sibling.getByLabel("Your perspective").fill("Other lead draft.");
    await field.fill(draft);
    await submit.click();
    try {
      await expect(error).toContainText("This review is no longer current.");
      await expect(error).toContainText("Checking the current question");
      await expect(submit).toBeDisabled();
      await expect(field).toHaveValue(draft);
      expect(submitted).toEqual([
        {
          checkpoint_id: initialCheckpoint,
          interrupt_id: primary.interrupt_id,
          decision: "approve",
          feedback: draft,
        },
      ]);
      if (expert) await expect(sibling.getByRole("alert")).toHaveCount(0);
    } finally {
      refresh.resolve();
    }
    await expect(submit).toBeEnabled();
    await expect(field).toHaveValue(draft);
    await expect(error).not.toContainText("Checking the current question");
    await expect(error).toContainText("The study has refreshed. You can try again.");
    expect(submitted).toHaveLength(1);
    await submit.click();
    await expect(submit).toHaveCount(0);
    expect(submitted).toEqual([
      expect.objectContaining({ checkpoint_id: initialCheckpoint }),
      {
        checkpoint_id: currentCheckpoint,
        interrupt_id: primary.interrupt_id,
        decision: "approve",
        feedback: draft,
      },
    ]);
    if (expert)
      await expect(sibling.getByLabel("Your perspective")).toHaveValue("Other lead draft.");

    if (scenario.kind === "editorial review") {
      let stops = 0;
      await page.route(`**/api/runs/${runId}/cancel`, (route) => {
        stops += 1;
        return route.fulfill({ status: 503, json: { detail: "The worker could not be reached." } });
      });
      const footer = page.locator("main footer");
      await page.evaluate(() => window.scrollTo(0, 0));
      const controls = page.getByRole("link", { name: "Session controls", exact: true });
      await expect(controls).toBeInViewport();
      await controls.press("Enter");
      await expect(page).toHaveURL(/#session-controls$/);
      await expect(footer).toBeFocused();
      const stop = footer.getByRole("button", { name: "Stop session" });
      const keep = footer.getByRole("button", { name: "Keep session" });
      await stop.press("Enter");
      await expect(keep).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(stop).toBeFocused();
      expect(stops).toBe(0);
      await stop.press("Enter");
      await footer.getByRole("button", { name: "Confirm stop" }).click();
      await expect(footer.getByRole("alert")).toContainText("The worker could not be reached.");
      expect(stops).toBe(1);
      await keep.click();
      await expect(footer.getByRole("alert")).toHaveCount(0);
      await expect(stop).toBeFocused();
    }
  });
}
