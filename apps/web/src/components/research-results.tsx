"use client";

import { researchToolUrls } from "./research-tool-receipts";
import { Button } from "@ui-sdk/react/button";
import type { RunSnapshot } from "@/lib/workflow";
import { ResearchAttempt } from "./research-attempt";

export function ResearchResults({ run }: { run: RunSnapshot }) {
  const manifest = run.research_manifest;
  if (!manifest) return null;
  const attempts = run.model_attempts ?? [];
  const limits = manifest.settings.limits;
  const returnedModels = [
    ...new Set(attempts.map(({ returned_model }) => returned_model).filter(Boolean)),
  ];
  const labels = new Map(run.workflow.nodes.map((node) => [`root/${node.id}`, node.label]));
  for (const event of run.events) {
    if (event.path) labels.set(event.path, event.label);
  }
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ manifest, attempts }, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `research-${run.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="research-results" aria-label="Research results">
      <div className="section-heading">
        <h3>Step outputs</h3>
        <span className="muted">
          {attempts.length} / {limits?.max_model_calls} model attempts
        </span>
      </div>
      {attempts.map((attempt, index) => (
        <ResearchAttempt
          key={attempt.id}
          attempt={attempt}
          latest={index === attempts.length - 1}
          label={labels.get(attempt.path) ?? attempt.path}
          sources={
            new Set(
              attempts
                .slice(0, index + 1)
                .flatMap((item) => [
                  ...(item.result?.web_research?.sources.map((source) => source.url) ?? []),
                  ...researchToolUrls(item.result),
                ]),
            )
          }
        />
      ))}
      <details className="run-details">
        <summary>Research manifest</summary>
        <section className="run-model-summary" aria-label="Run model">
          <dl>
            <dt>
              {attempts.some((item) => item.model !== manifest.settings.model)
                ? "Workflow default"
                : "Selected model"}
            </dt>
            <dd>{manifest.settings.model}</dd>
            <dt>Provider-reported models</dt>
            <dd>{returnedModels.length ? returnedModels.join(", ") : "Not reported yet"}</dd>
            <dt>Connection</dt>
            <dd>ChatGPT included plan · {manifest.account_label}</dd>
            <dt>Evidence reads</dt>
            <dd>
              {run.usage?.tool_calls ?? 0} / {limits?.max_tool_calls}
            </dd>
            <dt>Active time</dt>
            <dd>{(run.usage?.active_seconds ?? 0).toFixed(1)} seconds</dd>
            <dt>Reported tokens</dt>
            <dd>
              {(run.usage?.input_tokens ?? 0) + (run.usage?.output_tokens ?? 0)}
              {!run.usage?.usage_complete && " (incomplete)"}
            </dd>
          </dl>
        </section>
        <Button className="button small" onClick={download}>
          Download research manifest
        </Button>
        <details>
          <summary>Manifest JSON</summary>
          <pre>{JSON.stringify(manifest, null, 2)}</pre>
        </details>
      </details>
    </section>
  );
}
