import { runRequest } from "./run-fixture";
import { expect, type APIRequestContext } from "@playwright/test";
import research from "../../../examples/hypothesis-research.json";
import type { ReportRevision, StyleGuide } from "../src/lib/reports";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=",
  "base64",
);
export async function prepare(request: APIRequestContext, tag: string) {
  const sourceResponse = await request.post("/api/evidence", {
    data: {
      id: crypto.randomUUID(),
      title: `Report source ${tag}`,
      kind: "text",
      rights: "owned",
      text: "An exact synthetic quotation. This is not market evidence.",
    },
  });
  expect(sourceResponse.status()).toBe(201);
  const source = await sourceResponse.json();
  const uploaded = await request.post("/api/artifacts?name=chart.png&rights=owned", {
    data: png,
    headers: { "Content-Type": "application/octet-stream" },
  });
  expect(uploaded.status()).toBe(201);
  const artifact = await uploaded.json();
  const chartResponse = await request.post("/api/evidence", {
    data: {
      id: crypto.randomUUID(),
      title: `Captured chart ${tag}`,
      kind: "image",
      representation: "chart_screenshot",
      rights: "owned",
      artifact_id: artifact.id,
      notes: "Synthetic image fixture; no market observations.",
    },
  });
  expect(chartResponse.status()).toBe(201);
  const chart = await chartResponse.json();
  const document = structuredClone(research);
  document.name = `Report research ${tag}`;
  document.research.model = "test-model";
  const workflowResponse = await request.post("/api/revisions", { data: document });
  expect(workflowResponse.status()).toBe(201);
  const revision = await workflowResponse.json();
  const runResponse = await runRequest(request, "/api/runs", {
    data: {
      id: crypto.randomUUID(),
      revision_id: revision.id,
      brief: "Synthetic report editing fixture.",
      evidence_ids: [source.id, chart.id],
      provider_account_id: "oaiapp_fixture",
    },
    timeout: 45000,
  });
  expect(runResponse.status()).toBe(200);
  return { source, chart, run: await runResponse.json() };
}
export function styleBody(tag: string) {
  return {
    id: crypto.randomUUID(),
    title: `Guide ${tag}`,
    analytical_structure: "Mechanism, alternatives, falsifiers.",
    voice: "Direct and conditional.",
    source_discipline: "Cite original sources and dates.",
    scenarios: "Conditional, not forecasts.",
    examples: [
      {
        kind: "structure",
        principle: "Explain alternatives.",
        example: "A could explain X; B is not excluded.",
      },
      {
        kind: "voice",
        principle: "Name uncertainty.",
        example: "The source cannot establish causation.",
      },
    ],
    change_note: "Synthetic guide.",
  };
}
export async function seed(request: APIRequestContext, tag: string) {
  const context = await prepare(request, tag);
  const style = await request.post("/api/style-guides", { data: styleBody(tag) });
  expect(style.status()).toBe(201);
  const guide: StyleGuide = await style.json();
  const response = await request.post("/api/reports", {
    data: {
      id: crypto.randomUUID(),
      title: `Report ${tag}`,
      run_id: context.run.id,
      attempt_id: context.run.model_attempts[0].id,
      style_guide_id: guide.id,
    },
  });
  expect(response.status()).toBe(201);
  return { ...context, guide, record: (await response.json()) as ReportRevision };
}
