"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/workflow";
import {
  availabilityLabels,
  evidenceUrl,
  representationLabels,
  type EvidenceRecord,
} from "@/lib/evidence";

export function PinnedEvidence({ ids }: { ids: string[] }) {
  const [items, setItems] = useState<EvidenceRecord[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all(ids.map((id) => api<EvidenceRecord>(`evidence/${encodeURIComponent(id)}`)))
      .then((records) => {
        if (active) setItems(records);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Unable to inspect pinned evidence.");
      });
    return () => {
      active = false;
    };
  }, [ids]);
  if (!ids.length) return null;
  return (
    <section className="pinned-evidence" aria-label="Pinned evidence">
      <h3>
        Pinned evidence <span className="count">{ids.length}</span>
      </h3>
      <p className="field-hint">
        These source versions stay attached when provenance is corrected later.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ul>
        {ids.map((id) => {
          const item = items.find((source) => source.id === id);
          return (
            <li key={id}>
              <a href={evidenceUrl(id)}>{item?.title ?? `Inspect source ${id.slice(0, 8)}`}</a>
              {item && (
                <span>
                  {representationLabels[item.representation ?? "original"]} ·{" "}
                  {availabilityLabels[item.availability ?? "available"]}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
