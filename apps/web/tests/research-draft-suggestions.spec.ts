import { expect, test, type Page } from "./fixtures";

const options = [
  "Start with the first available release.",
  "Use the second published release.",
] as const;
const question = "Which release should guide the comparison?";
const ownerDraft = "  Compare both releases first.\nKeep the same observation cutoff.  ";

async function openDecision(page: Page, firstReading: boolean) {
  const id = crypto.randomUUID();
  const createdAt = "2026-11-25T03:00:00Z";
  const path = firstReading ? "root/working_sentence" : "root/team/lead-1/turn-1";
  const perspective = {
    action_path: path,
    lead_title: "Credit",
    question,
    thesis: "The release date could change the comparison.",
    options,
    worker_paths: [],
  };
  const review = {
    node_id: firstReading ? "working_sentence" : "team",
    path,
    interrupt_id: crypto.randomUUID(),
    question,
    ...(!firstReading && { perspective }),
  };
  function attempt(path: string, result: object) {
    return {
      id: crypto.randomUUID(),
      path,
      status: "completed",
      model: "synthetic",
      stage: "custom",
      created_at: createdAt,
      finished_at: createdAt,
      input_bytes: 0,
      output_characters: 0,
      result: { limitations: [], ...result },
    };
  }
  const modelAttempts = firstReading
    ? [
        attempt("root/discovery", {
          discovery: {
            observation: "The two synthetic releases report different figures.",
            question,
            proposals: options.map((sentence) => ({
              sentence,
              alternative: "The difference may reflect which release was selected.",
              first_check: "Check release dates before comparing observations.",
              weaken_if: "The observation cutoffs are different.",
              evidence_ids: [],
            })),
            citations: [],
          },
        }),
      ]
    : [
        attempt("root/team/plan", {
          swarm_plan: { leads: [{ title: "Credit", objective: "Check vintage selection." }] },
        }),
        attempt(path, { swarm_action: { action: "ask_expert", consultation: perspective } }),
      ];
  const snapshot = {
    id,
    brief: "Review synthetic release vintages.",
    created_at: createdAt,
    status: "paused",
    execution_pending: false,
    checkpoint_id: crypto.randomUUID(),
    review,
    reviews: [review],
    events: [],
    artifacts: [],
    evidence_ids: [],
    workflow: {
      nodes: firstReading
        ? []
        : [{ id: "team", config: { type: "research", team: { swarm: { lead_count: 1 } } } }],
    },
    research_manifest: {
      settings: { model: "synthetic", limits: { max_model_calls: 30 } },
      evidence: [],
      tool_config: {
        session: "brief-led-1",
        ...(firstReading && { discovery_version: "discovery-1" }),
      },
    },
    model_attempts: modelAttempts,
  };
  let submissions = 0;
  await page.route(`**/api/runs/${id}`, (route) => route.fulfill({ json: snapshot }));
  await page.route(`**/api/runs/${id}/resume`, (route) => {
    submissions += 1;
    return route.abort();
  });
  await page.goto(`/?session=${id}`);
  const region = page.getByRole("region", {
    name: firstReading ? "Source-led investigation" : "Credit requests your perspective",
  });
  const field = region.getByLabel(firstReading ? "Your working sentence" : "Your perspective");
  function suggestion(option: string) {
    return firstReading
      ? region
          .getByRole("article", { name: option, exact: true })
          .getByRole("button", { name: "Use this sentence", exact: true })
      : region.getByRole("button", { name: option, exact: true });
  }
  return {
    region,
    field,
    first: suggestion(options[0]),
    second: suggestion(options[1]),
    submissions: () => submissions,
  };
}

for (const width of [390, 1440]) {
  for (const kind of ["working sentence", "perspective"] as const) {
    test(`preserves a conflicting ${kind} draft until an explicit replacement at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const { region, field, first, second, submissions } = await openDecision(
        page,
        kind === "working sentence",
      );
      const confirmation = region.getByRole("group", { name: "Replace your draft?" });
      const keep = confirmation.getByRole("button", { name: "Keep draft", exact: true });
      const replace = confirmation.getByRole("button", { name: "Replace draft", exact: true });
      await expect(field).toBeEmpty();
      await first.press("Enter");
      await expect(field).toHaveValue(options[0]);
      await expect(field).toBeFocused();
      await expect(confirmation).toHaveCount(0);
      await first.press("Enter");
      await expect(field).toBeFocused();
      await expect(confirmation).toHaveCount(0);
      await second.press("Enter");
      await expect(field).toHaveValue(options[1]);
      await expect(field).toBeFocused();
      await expect(confirmation).toHaveCount(0);
      await page.reload();
      await expect(field).toHaveValue(options[1]);
      await first.press("Enter");
      await expect(field).toHaveValue(options[0]);
      await expect(confirmation).toHaveCount(0);

      await field.fill(ownerDraft);
      await second.press("Enter");
      await expect(confirmation).toContainText(options[1]);
      await expect(keep).toBeFocused();
      await expect(keep).toBeInViewport();
      await expect(field).toHaveValue(ownerDraft);
      await second.press("Enter");
      await expect(keep).toBeFocused();
      await first.press("Enter");
      await expect(confirmation).toContainText(options[0]);
      await expect(keep).toBeFocused();
      await page.reload();
      await expect(field).toHaveValue(ownerDraft);
      await expect(confirmation).toHaveCount(0);

      await second.press("Enter");
      await expect(keep).toBeFocused();
      await keep.press("Enter");
      await expect(field).toBeFocused();
      await expect(field).toHaveValue(ownerDraft);
      await expect(confirmation).toHaveCount(0);
      await second.press("Enter");
      await replace.press("Enter");
      await expect(field).toBeFocused();
      await expect(field).toHaveValue(options[1]);
      await expect(confirmation).toHaveCount(0);
      await page.reload();
      await expect(field).toHaveValue(options[1]);
      expect(submissions()).toBe(0);
    });
  }
}
