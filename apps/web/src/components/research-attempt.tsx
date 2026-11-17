import type { components } from "@researchchain/contracts";
import { useState } from "react";
import { contentUrl, evidenceUrl } from "@/lib/evidence";
import { ResearchMarkdown } from "./research-markdown";
import { ResearchToolReceipts } from "./research-tool-receipts";

type Attempt = components["schemas"]["ModelAttempt"];

function WebSources({ trace }: { trace: components["schemas"]["WebResearch"] }) {
  return (
    <details className="research-disclosure">
      <summary>
        Web sources <span className="count">{trace.sources.length}</span>
      </summary>
      <p className="field-hint">
        Provider-reported references · {new Date(trace.observed_at).toLocaleString()}
      </p>
      <ul>
        {trace.sources.map((source) => (
          <li key={source.url}>
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.title || source.url}
            </a>{" "}
            · {source.cited ? "Cited by provider" : "Consulted by provider"}
          </li>
        ))}
      </ul>
      {!trace.sources.length && <p>No source URLs were returned by the provider.</p>}
      {trace.truncated && <p>Source or action metadata exceeded the display limit.</p>}
      <details>
        <summary>
          Search activity <span className="count">{trace.actions.length}</span>
        </summary>
        <ul>
          {trace.actions.map((action, index) => (
            <li key={`${action.id}-${index}`}>
              {action.action} · {action.status}
              {action.queries.length ? ` · ${action.queries.join(", ")}` : ""}
              {action.url ? ` · ${action.url}` : ""}
            </li>
          ))}
        </ul>
      </details>
    </details>
  );
}

export function ResearchAttempt({
  attempt,
  latest,
  label,
  sources,
}: {
  attempt: Attempt;
  latest: boolean;
  label: string;
  sources: Set<string>;
}) {
  const [expanded, setExpanded] = useState(latest);
  const result = expanded ? attempt.result : null;
  const prose = (text: string) => <ResearchMarkdown text={text} sources={sources} />;
  const list = (items: string[]) => (
    <ul>
      {items.map((item, index) => (
        <li key={index}>{prose(item)}</li>
      ))}
    </ul>
  );
  return (
    <details
      name="model-step-output"
      className="research-attempt"
      open={latest}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        {label}{" "}
        <span className="attempt-status" data-status={attempt.status}>
          {attempt.status}
        </span>
      </summary>
      {attempt.reason && <p className="error">{attempt.reason}</p>}
      {result && (
        <>
          <div className="research-conclusion">{prose(result.conclusion)}</div>
          {!!result.hypotheses.length && (
            <details className="research-disclosure">
              <summary>
                Hypotheses <span className="count">{result.hypotheses.length}</span>
              </summary>
              {result.hypotheses.map((hypothesis) => (
                <article className="hypothesis" key={hypothesis.id}>
                  <h4>
                    {hypothesis.id} · {hypothesis.assessment}
                  </h4>
                  {prose(hypothesis.statement)}
                  <h5>Alternative explanations</h5>
                  {list(hypothesis.alternatives)}
                  <h5>What would falsify it</h5>
                  {list(hypothesis.falsifiers)}
                  <h5>Evidence</h5>
                  {hypothesis.citations.length ? (
                    <ul className="research-citations">
                      {hypothesis.citations.map((citation, index) => (
                        <li key={index}>
                          <a
                            href={evidenceUrl(citation.evidence_id)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {citation.locator}
                          </a>{" "}
                          · {citation.relation} · {citation.basis.replaceAll("_", " ")}
                          {citation.quote && <blockquote>{citation.quote}</blockquote>}
                          {prose(citation.rationale)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No substantive source citations.</p>
                  )}
                </article>
              ))}
            </details>
          )}
          {result.web_research && <WebSources trace={result.web_research} />}
          <ResearchToolReceipts result={result} />
          <details className="research-disclosure">
            <summary>Limitations and open questions</summary>
            <h4>Limitations</h4>
            {list(result.limitations)}
            {!!result.unresolved_questions.length && (
              <>
                <h4>Unresolved questions</h4>
                {list(result.unresolved_questions)}
              </>
            )}
            {!!result.evidence_requests.length && (
              <>
                <h4>Evidence to seek</h4>
                <ul>
                  {result.evidence_requests.map((item, index) => (
                    <li key={index}>
                      {prose(item.question)}
                      {prose(item.source_needed)}
                      {prose(item.why)}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </details>
        </>
      )}
      <details className="research-disclosure" open={!attempt.result}>
        <summary>Attempt details</summary>
        {result && result.revision_summary !== result.conclusion && prose(result.revision_summary)}
        <dl className="attempt-details">
          <dt>Step path</dt>
          <dd>{attempt.path}</dd>
          <dt>Requested model</dt>
          <dd>{attempt.model}</dd>
          <dt>Provider-reported model</dt>
          <dd>{attempt.returned_model ?? "Not reported"}</dd>
          <dt>Characters received</dt>
          <dd>{attempt.output_characters.toLocaleString()}</dd>
        </dl>
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
    </details>
  );
}
