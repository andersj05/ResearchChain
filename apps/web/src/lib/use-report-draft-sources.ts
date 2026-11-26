import { useEffect, useMemo, useState } from "react";
import type { ReportDraftSources } from "@/lib/reports";
import { api } from "@/lib/workflow";

type DraftSourceRead = {
  query: string;
  retry: number;
  data?: ReportDraftSources;
};

export function useReportDraftSources(ids: string[]) {
  const query = useMemo(() => {
    const params = new URLSearchParams();
    for (const id of ids.toSorted()) params.append("evidence_id", id);
    return params.toString();
  }, [ids]);
  const [read, setRead] = useState<DraftSourceRead>();
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!query) return;
    let active = true;
    void api<ReportDraftSources>(`reports/draft-sources?${query}`).then(
      (data) => {
        if (active) setRead({ query, retry, data });
      },
      () => {
        if (active) setRead((previous) => ({ query, retry, data: previous?.data }));
      },
    );
    return () => {
      active = false;
    };
  }, [query, retry]);

  const { sources, sourceBases, unresolvedIds } = useMemo(() => {
    const byId = new Map(read?.data?.sources.map((source) => [source.id, source]));
    const sourceBases: ReportDraftSources["source_bases"] = {};
    const unresolvedIds: string[] = [];
    // Reuse exact records while a different set loads, with membership owned by the draft.
    const sources = ids.flatMap((id) => {
      const source = byId.get(id);
      const basis = read?.data?.source_bases[id];
      if (!source || !basis) {
        unresolvedIds.push(id);
        return [];
      }
      sourceBases[id] = basis;
      return [source];
    });
    return { sources, sourceBases, unresolvedIds };
  }, [ids, read?.data]);
  const settled = read?.query === query && read.retry === retry;
  return {
    sources,
    sourceBases,
    unresolvedIds,
    loading: Boolean(query) && !settled,
    unavailable: settled && unresolvedIds.length > 0,
    retry: () => setRetry((value) => value + 1),
  };
}
