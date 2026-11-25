import { useRef, useState } from "react";
import {
  evidenceAvailabilityLabel,
  evidenceUrl,
  sourceMetadata,
  type EvidenceRecord,
} from "@/lib/evidence";
import { useSourceDetails } from "@/lib/use-evidence-library";
import type { RunSnapshot } from "@/lib/workflow";
import { SourceChartDialog, type ChartPreviewSource } from "./source-chart-dialog";
import styles from "./study-pinned-sources.module.css";

const chartMediaTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

function sourceDestination(value?: string | null) {
  if (!value) return;
  try {
    const url = new URL(value);
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) return url;
  } catch {
    // Older study records may have unusable URLs.
  }
}

export function useStudySourceDetails(
  run: RunSnapshot | undefined,
  active: boolean,
  readingRequested: boolean,
) {
  const [settingsIds, setSettingsIds] = useState<string[] | null>(null);
  const snapshots = new Map(
    run?.research_manifest?.evidence?.map((item) => [item.evidence_id, item]),
  );
  const pinned = run?.evidence_ids?.length ? run.evidence_ids : [...snapshots.keys()];
  const reading =
    run?.model_attempts?.find(
      (attempt) => attempt.path === "root/discovery" && attempt.status === "completed",
    )?.result?.discovery ?? undefined;
  const cited = new Set(reading?.citations.map((citation) => citation.evidence_id));
  const readingIds = readingRequested
    ? pinned.filter((id) => cited.has(id) && !settingsIds?.includes(id))
    : [];
  const readingRecords = useSourceDetails(active ? readingIds : []);
  const settingsRecords = useSourceDetails(active ? (settingsIds ?? []) : []);
  const mismatched = new Set<string>();
  const items = new Map<string, EvidenceRecord>();
  for (const [id, record] of [...readingRecords.items, ...settingsRecords.items]) {
    const pinnedSource = snapshots.get(id);
    const original = record.content_hash ?? record.artifact?.id ?? null;
    if (record.id === id && (!pinnedSource || pinnedSource.original === original)) {
      items.set(id, record);
    } else mismatched.add(id);
  }
  const unresolved = [...readingRecords.unresolved, ...settingsRecords.unresolved];
  return {
    pinned,
    snapshots,
    mismatched,
    reading,
    settingsRequested: settingsIds !== null,
    requestSettings: () => {
      if (settingsIds === null) setSettingsIds(pinned.filter((id) => !readingIds.includes(id)));
    },
    sources: {
      items,
      unresolved,
      retry: async () => {
        await Promise.all([readingRecords.retry(), settingsRecords.retry()]);
      },
    },
  };
}

export function StudyPinnedSources({
  lookup,
  artifacts,
}: {
  lookup: ReturnType<typeof useStudySourceDetails>;
  artifacts: RunSnapshot["artifacts"];
}) {
  const [previewId, setPreviewId] = useState<string>();
  const opener = useRef<HTMLButtonElement>(null);
  const names = new Map(artifacts.map((artifact) => [artifact.id, artifact.name]));
  const unavailable = new Set(lookup.sources.unresolved);
  const charts = new Map<string, ChartPreviewSource>();
  for (const id of lookup.pinned) {
    const snapshot = lookup.snapshots.get(id);
    const record = lookup.sources.items.get(id);
    const artifact = record?.artifact;
    if (
      snapshot?.representation === "chart_screenshot" &&
      snapshot.availability === "available" &&
      record &&
      artifact?.id === snapshot.original &&
      /^sha256:[a-f0-9]{64}$/u.test(artifact.id) &&
      chartMediaTypes.has(artifact.media_type)
    ) {
      charts.set(id, {
        id,
        title: record.title,
        artifactId: artifact.id,
        attribution: [
          record.author || snapshot.publisher,
          snapshot.as_of_date && `As of ${snapshot.as_of_date}`,
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }
  }
  if (!lookup.pinned.length) return null;
  return (
    <section className={styles.sources} aria-label="Pinned study sources">
      <h3>Pinned sources</h3>
      <p>
        This list follows the study’s reading order. Titles and authors come from the corresponding
        source versions in the library.
      </p>
      <ol aria-label="Pinned source reading order">
        {lookup.pinned.map((id) => {
          const snapshot = lookup.snapshots.get(id);
          const record = lookup.sources.items.get(id);
          const details = snapshot ?? record;
          const destination = sourceDestination(details?.source_url);
          const title =
            record?.title ||
            (snapshot?.original && names.get(snapshot.original)) ||
            snapshot?.publisher ||
            `Source ${id.slice(0, 8)}`;
          const attribution = [
            record?.author &&
              `${record.kind === "discussion" ? "Speaker" : "Author"} ${record.author}`,
            details?.publisher &&
              details.publisher !== record?.author &&
              `Publisher ${details.publisher}`,
          ].filter(Boolean);
          return (
            <li key={id}>
              <div className={styles.sourceHeading}>
                {record ? (
                  <a href={evidenceUrl(id)} target="_blank" rel="noopener">
                    {title}
                  </a>
                ) : (
                  <strong>{title}</strong>
                )}
                {charts.has(id) && (
                  <button
                    type="button"
                    className="text-link"
                    aria-label={`Preview chart ${title}`}
                    aria-haspopup="dialog"
                    onClick={(event) => {
                      opener.current = event.currentTarget;
                      setPreviewId(id);
                    }}
                  >
                    Preview chart
                  </button>
                )}
              </div>
              {details && (
                <span>
                  {!snapshot && "From source record · "}
                  {sourceMetadata(details)} · {evidenceAvailabilityLabel(details.availability)}
                </span>
              )}
              {!!attribution.length && <span>{attribution.join(" · ")}</span>}
              {destination && (
                <span>
                  <a href={destination.href} target="_blank" rel="noopener noreferrer">
                    Recorded URL at {destination.hostname}
                  </a>
                </span>
              )}
              {lookup.mismatched.has(id) ? (
                <span>Source record differs from the pinned original.</span>
              ) : unavailable.has(id) ? (
                <span>
                  {snapshot
                    ? "Saved snapshot · Source record unavailable"
                    : "Source record unavailable"}
                </span>
              ) : !record ? (
                <span>Loading source record…</span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {!!unavailable.size && (
        <button className="text-link" type="button" onClick={() => void lookup.sources.retry()}>
          Retry unavailable sources
        </button>
      )}
      <SourceChartDialog
        charts={[...charts.values()]}
        selectedId={previewId}
        onSelect={setPreviewId}
        opener={opener}
      />
    </section>
  );
}
