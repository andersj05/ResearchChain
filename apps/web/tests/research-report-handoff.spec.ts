import type { ReportSummary } from "../src/lib/reports";
import { expect, test } from "./fixtures";
import { styleBody } from "./report-fixture";

test("offer explicit saved report heads from the exact editor pass and keep creation available", async ({
  page,
}) => {
  const runId = crypto.randomUUID();
  const editorId = crypto.randomUUID();
  const earlierId = crypto.randomUUID();
  const artifactId = crypto.randomUUID();
  const sectionId = crypto.randomUUID();
  const now = "2026-11-24T18:00:00Z";
  const markdown = "# Saved synthetic report\n\nCompare the two release dates.";
  const revisedText = "Edited report text after adding another reference.";
  const guide = { ...styleBody("handoff"), version: 1, created_at: now };
  const head: ReportSummary = {
    id: crypto.randomUUID(),
    series_id: crypto.randomUUID(),
    title: "Renamed editorial report",
    version: 2,
    author: "human",
    created_at: now,
    change_note: "Added another reference.",
  };
  const otherId = crypto.randomUUID();
  const other: ReportSummary = {
    ...head,
    id: otherId,
    series_id: otherId,
    title: "Separate editorial report",
    version: 1,
    author: "research_seed",
    change_note: "Seeded from the same editor pass.",
  };
  const earlier = {
    id: earlierId,
    path: "root/report",
    status: "completed",
    model: "synthetic",
    created_at: now,
    result: { limitations: [], next_lead: "Check the prior release." },
  };
  const editorPass = {
    ...earlier,
    id: editorId,
    path: "root/report/analyst-pass-2",
    finished_at: now,
    result: {
      limitations: [],
      workspace_files: [
        {
          name: "report.md",
          artifact_id: artifactId,
          media_type: "text/markdown",
          byte_size: Buffer.byteLength(markdown),
        },
      ],
    },
  };
  const lookups: (readonly [string | null, string | null])[] = [];
  const releaseLookup = Promise.withResolvers<void>();
  let failLookup = false;
  let recentReads = 0;
  let submissions = 0;
  await page.route(`**/api/artifacts/${artifactId}/content`, (route) =>
    route.fulfill({ contentType: "text/markdown", body: markdown }),
  );
  await page.route(`**/api/runs/${runId}`, (route) =>
    route.fulfill({
      json: {
        id: runId,
        brief: "Original study title",
        created_at: now,
        status: "completed",
        execution_pending: false,
        events: [],
        artifacts: [],
        evidence_ids: [],
        workflow: { nodes: [] },
        research_manifest: {
          settings: { model: "synthetic", limits: { max_model_calls: 25 } },
          tool_config: { session: "brief-led-1" },
          evidence: [],
        },
        model_attempts: [earlier, editorPass],
      },
    }),
  );
  await page.route("**/api/style-guides", (route) => route.fulfill({ json: [guide] }));
  await page.route(`**/api/reports/${head.id}`, (route) =>
    route.fulfill({
      json: {
        revision: {
          ...head,
          style_guide_id: guide.id,
          sections: [
            {
              id: sectionId,
              heading: "Study report",
              kind: "interpretation",
              body: revisedText,
              citations: [],
              chart_ids: [],
            },
          ],
          sources: [],
          provenance: { renderer: "study-markdown-1", run_id: runId, attempt: editorPass },
        },
        current_revision_id: head.id,
        style_guide: guide,
        source_bases: {},
        feedback: [],
        review_status: "unreviewed",
      },
    }),
  );
  await page.route(`**/api/reports/${head.id}/history`, (route) => route.fulfill({ json: [head] }));
  await page.route(
    (url) => url.pathname === "/api/reports",
    async (route) => {
      if (route.request().method() === "POST") {
        submissions++;
        return route.fulfill({ status: 500 });
      }
      const params = new URL(route.request().url()).searchParams;
      if (!params.has("study_run_id")) {
        recentReads++;
        return route.fulfill({ json: [{ ...head, id: crypto.randomUUID() }] });
      }
      const pair = [params.get("study_run_id"), params.get("study_attempt_id")] as const;
      lookups.push(pair);
      await releaseLookup.promise;
      if (failLookup) return route.fulfill({ status: 503 });
      return route.fulfill({
        json: pair[0] === runId && pair[1] === editorId ? [head, other] : [],
      });
    },
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?session=${runId}&workspace=editor`);
  const handoff = (attemptId: string) =>
    `/?${new URLSearchParams({ view: "reports", fromStudy: runId, reportAttempt: attemptId })}`;
  const edit = page.getByRole("link", { name: "Edit in Reports", exact: true });
  await expect(edit).toHaveAttribute("href", handoff(editorId));
  await edit.press("Enter");
  const create = page.getByRole("button", { name: "Create report draft", exact: true });
  const matches = page.getByRole("region", { name: "Saved reports from this editor pass" });
  try {
    await expect(page.getByText("Checking for saved reports from this editor pass…")).toBeVisible();
    await expect(create).toBeEnabled();
  } finally {
    releaseLookup.resolve();
  }
  await expect(matches.getByRole("link")).toHaveCount(2);
  await expect(matches).toContainText("create a separate report");
  await expect(create).toBeEnabled();
  const editor = page.getByRole("region", { name: "Report editor", exact: true });
  await expect(editor).toHaveCount(0);
  expect(lookups).toEqual([[runId, editorId]]);
  expect(recentReads).toBe(0);

  const latest = matches.getByRole("link", { name: /Open Renamed editorial report.*Revision 2/ });
  const expected = `/?view=reports&report=${head.id}`;
  await expect(latest).toHaveAttribute("href", expected);
  await latest.press("Enter");
  await expect(page).toHaveURL(expected);
  await expect(editor.getByRole("textbox", { name: "Section text" })).toHaveValue(revisedText);
  expect(lookups).toHaveLength(1);

  await page.goto(handoff(earlierId));
  await expect(create).toBeEnabled();
  await expect.poll(() => lookups.at(-1)).toEqual([runId, earlierId]);
  await expect(page.getByText("Checking for saved reports from this editor pass…")).toHaveCount(0);
  await expect(matches).toHaveCount(0);

  failLookup = true;
  await page.goto(handoff(editorId));
  const reports = page.getByRole("region", { name: "Reports", exact: true });
  await expect(reports.getByRole("alert")).toContainText("Could not check for saved reports");
  await expect(create).toBeEnabled();
  failLookup = false;
  await page.getByRole("button", { name: "Retry report lookup" }).press("Enter");
  await expect(matches.getByRole("link")).toHaveCount(2);
  expect(submissions).toBe(0);
});
