"use client";

import type { RunSnapshot } from "@/lib/workflow";
import { contentUrl, evidenceUrl } from "@/lib/evidence";
import { Button } from "@ui-sdk/react/button";

const stageLabels = {
  hypothesize: "Hypotheses",
  challenge: "Evidence challenge",
  revise: "Revised conclusions",
};
export function ResearchResults({ run }: { run: RunSnapshot }) {
  const manifest = run.research_manifest;
  if (!manifest) return null;
  const attempts = run.model_attempts ?? [];
  const limits = manifest.settings.limits;
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
        <h3>Research progress</h3>
        <span className="code-label">{manifest.settings.model}</span>
      </div>
      <p className="muted">
        {attempts.length} / {limits?.max_model_calls} model attempts · {run.usage?.tool_calls ?? 0}{" "}
        / {limits?.max_tool_calls} evidence reads · {(run.usage?.active_seconds ?? 0).toFixed(1)}{" "}
        active seconds
      </p>
      <p className="field-hint">
        {(run.usage?.input_tokens ?? 0) + (run.usage?.output_tokens ?? 0)} reported tokens.{" "}
        {run.usage?.usage_complete
          ? "Usage recorded."
          : "Usage is incomplete while a request is pending or interrupted."}
      </p>
      {attempts.map((attempt, index) => (
        <details className="research-attempt" key={attempt.id} open={index === attempts.length - 1}>
          <summary>
            {stageLabels[attempt.stage]} · {attempt.status}
          </summary>
          <p className="field-hint">
            {attempt.path} · {attempt.output_characters.toLocaleString()} characters received
          </p>
          {attempt.reason && <p className="error">{attempt.reason}</p>}
          {attempt.result && (
            <>
              <p className="research-conclusion">{attempt.result.conclusion}</p>
              <p>{attempt.result.revision_summary}</p>
              {attempt.result.hypotheses.map((hypothesis) => (
                <article className="hypothesis" key={hypothesis.id}>
                  <h4>
                    {hypothesis.id} · {hypothesis.assessment}
                  </h4>
                  <p>{hypothesis.statement}</p>
                  <h5>Alternative explanations</h5>
                  <ul>
                    {hypothesis.alternatives.map((text, i) => (
                      <li key={i}>{text}</li>
                    ))}
                  </ul>
                  <h5>What would falsify it</h5>
                  <ul>
                    {hypothesis.falsifiers.map((text, i) => (
                      <li key={i}>{text}</li>
                    ))}
                  </ul>
                  <h5>Evidence</h5>
                  {hypothesis.citations.length ? (
                    <ul className="research-citations">
                      {hypothesis.citations.map((citation, i) => (
                        <li key={i}>
                          <a
                            href={evidenceUrl(citation.evidence_id)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {citation.locator}
                          </a>{" "}
                          · {citation.relation} · {citation.basis.replaceAll("_", " ")}
                          {citation.quote && <blockquote>{citation.quote}</blockquote>}
                          <p>{citation.rationale}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No substantive source citations.</p>
                  )}
                </article>
              ))}
              {!!attempt.result.unresolved_questions.length && (
                <>
                  <h4>Unresolved questions</h4>
                  <ul>
                    {attempt.result.unresolved_questions.map((text, i) => (
                      <li key={i}>{text}</li>
                    ))}
                  </ul>
                </>
              )}
              {!!attempt.result.evidence_requests.length && (
                <>
                  <h4>Evidence to seek</h4>
                  <ul>
                    {attempt.result.evidence_requests.map((item, i) => (
                      <li key={i}>
                        <strong>{item.question}</strong>
                        <p>
                          {item.source_needed} — {item.why}
                        </p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h4>Limitations</h4>
              <ul>
                {attempt.result.limitations.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            </>
          )}
          <div className="actions">
            {attempt.input_artifact_id && (
              <a className="text-link" href={contentUrl(attempt.input_artifact_id)}>
                Saved request
              </a>
            )}
            {attempt.response_artifact_id && (
              <a className="text-link" href={contentUrl(attempt.response_artifact_id)}>
                Saved response{attempt.status !== "completed" ? " (unvalidated)" : ""}
              </a>
            )}
          </div>
        </details>
      ))}
      <details className="run-details">
        <summary>Research manifest</summary>
        <p>{manifest.account_label} · ChatGPT included plan</p>
        <p className="field-hint">
          The manifest records model IDs, prompt versions, limits and pinned sources. Token
          thresholds prevent further calls; they do not cap a response already in progress.
        </p>
        <Button className="button small" onClick={download}>
          Download research manifest
        </Button>
        <pre>{JSON.stringify(manifest, null, 2)}</pre>
      </details>
    </section>
  );
}
