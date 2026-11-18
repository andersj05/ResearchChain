"use client";

import { Button } from "@ui-sdk/react/button";
import { useSourceDetails } from "@/lib/use-evidence-library";
import {
  evidenceAvailabilityLabel,
  evidenceUrl,
  sourceMetadata,
  type EvidenceSnapshot,
} from "@/lib/evidence";

export function PinnedEvidence({
  ids,
  snapshots,
}: {
  ids: string[];
  snapshots?: EvidenceSnapshot[];
}) {
  const { items, unresolved, retry } = useSourceDetails(ids);
  if (!ids.length) return null;
  const saved = new Map(snapshots?.map((source) => [source.evidence_id, source]));
  const unavailable = new Set(unresolved);
  return (
    <section className="pinned-evidence" aria-label="Pinned evidence">
      <h3>
        Pinned evidence <span className="count">{ids.length}</span>
      </h3>
      <p className="field-hint">
        These source versions stay attached when provenance is corrected later.
      </p>
      <ul>
        {ids.map((id) => {
          const item = items.get(id);
          const fallback = saved.get(id);
          const details = item ?? fallback;
          return (
            <li key={id}>
              <a href={evidenceUrl(id)} target="_blank" rel="noopener">
                {item?.title ?? `Inspect source ${id.slice(0, 8)}`}
              </a>
              {details && (
                <span>
                  {[
                    sourceMetadata(details),
                    evidenceAvailabilityLabel(details.availability),
                    details.publisher,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {!item && " · Saved with this run"}
                </span>
              )}
              {unavailable.has(id) && <span>Source details unavailable</span>}
            </li>
          );
        })}
      </ul>
      {unresolved.length > 0 && (
        <Button className="button small" onClick={retry}>
          Retry unavailable sources
        </Button>
      )}
    </section>
  );
}
