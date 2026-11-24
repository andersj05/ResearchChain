import type { components } from "@researchchain/contracts";
import { defaultPassComparisonLabels, type PassComparisonLabels } from "@/lib/run-inspection";

type WebResearch = components["schemas"]["WebResearch"];
type WebSource = WebResearch["sources"][number];

function recordedSources(record?: WebResearch | null) {
  return new Map(record?.sources.map((source) => [source.url, source]));
}

function externalUrl(value: string) {
  try {
    const url = new URL(value);
    if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) {
      return url.href;
    }
  } catch {
    // An invalid URL can still be shown as saved text.
  }
}

function SourceList({ sources }: { sources: WebSource[] }) {
  return (
    <ul>
      {sources.map(({ url, title }) => {
        const href = externalUrl(url);
        return (
          <li key={url} className="source-link-url">
            {href ? (
              <a href={href} target="_blank" rel="noreferrer">
                {title || url}
              </a>
            ) : (
              title || url
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function RunPassSourceComparison({
  comparison,
  current,
  labels = defaultPassComparisonLabels,
}: {
  comparison?: WebResearch | null;
  current?: WebResearch | null;
  labels?: PassComparisonLabels;
}) {
  if (!comparison && !current) return null;
  const before = recordedSources(comparison);
  const after = recordedSources(current);
  const shared = [...before.values()].filter((source) => after.has(source.url));
  const sides = [
    {
      label: labels.comparison,
      otherRecord: current,
      record: comparison,
      sources: [...before.values()].filter((source) => !after.has(source.url)),
    },
    {
      label: labels.current,
      otherRecord: comparison,
      record: current,
      sources: [...after.values()].filter((source) => !before.has(source.url)),
    },
  ];

  return (
    <details>
      <summary>Recorded web sources · {shared.length} shared</summary>
      <div className="comparison-inputs">
        {sides.map(({ label, record, otherRecord, sources }) => (
          <section key={label} aria-label={`${label} web sources`}>
            <h4>
              {otherRecord ? "Only recorded on" : "Recorded on"} the {label.toLowerCase()}
            </h4>
            {sources.length > 0 ? (
              <SourceList sources={sources} />
            ) : (
              <p className="muted">
                {record ? "No unique web sources recorded." : "No web source record saved."}
              </p>
            )}
            {record?.truncated && (
              <p className="field-hint">The saved source record is incomplete.</p>
            )}
          </section>
        ))}
      </div>
      {shared.length > 0 && (
        <details>
          <summary>Shared web sources ({shared.length})</summary>
          <SourceList sources={shared} />
        </details>
      )}
    </details>
  );
}
