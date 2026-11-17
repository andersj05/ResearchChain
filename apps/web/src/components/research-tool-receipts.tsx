import type { components } from "@researchchain/contracts";

type Result = components["schemas"]["StoredResearchResult"];

export function researchToolUrls(result?: Result | null) {
  const url = result?.sec_financials?.source_url;
  return url && result.sec_financials?.status === "available" ? [url] : [];
}

export function ResearchToolReceipts({ result }: { result: Result }) {
  const receipt = result.sec_financials;
  const feeds = result.web_research?.feeds ?? [];
  return (
    <>
      {feeds.length > 0 && <p>Provider feeds · {feeds.join(", ")}</p>}
      {receipt && (
        <details>
          <summary>
            SEC filings · {receipt.request.ticker} · {receipt.request.metric.replaceAll("_", " ")}
          </summary>
          {receipt.status === "available" ? (
            <>
              <p>
                <a href={receipt.source_url!} target="_blank" rel="noreferrer">
                  {receipt.issuer} · SEC filing data
                </a>
              </p>
              <dl>
                {receipt.observations?.map((item) => (
                  <div key={item.end}>
                    <dt>
                      {item.start} – {item.end}
                    </dt>
                    <dd>
                      {item.value.toLocaleString()} {item.unit} · {item.form} filed {item.filed} ·{" "}
                      {item.accession}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p>{receipt.detail}</p>
          )}
          <p className="field-hint">Lookup at {new Date(receipt.retrieved_at).toLocaleString()}</p>
        </details>
      )}
    </>
  );
}
