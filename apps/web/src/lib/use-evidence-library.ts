import { useEffect, useState } from "react";
import { api } from "@/lib/workflow";
import type { EvidencePage, EvidenceRecord } from "@/lib/evidence";

export type EvidenceAvailability = NonNullable<EvidenceRecord["availability"]>;

type Scope = { query: string; availability?: EvidenceAvailability; generation: number };
type Results = { scope: Scope; page: EvidencePage; error?: string };

export function listSources(query = "", availability?: EvidenceAvailability, offset = 0) {
  const params = new URLSearchParams({ limit: "50" });
  if (offset) params.set("offset", String(offset));
  if (query) params.set("search", query);
  if (availability) params.set("availability", availability);
  return api<EvidencePage>(`evidence?${params}`);
}

export function mergeSources(first: EvidenceRecord[], second: EvidenceRecord[]) {
  return [...new Map([...first, ...second].map((item) => [item.id, item])).values()];
}

export async function readSources(ids: string[]) {
  const results = await Promise.allSettled(
    ids.map((id) => api<EvidenceRecord>(`evidence/${encodeURIComponent(id)}`)),
  );
  return results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

export function useSourceDetails(ids: string[]) {
  // A packet's order belongs to its renderer. Fetch details for its source set.
  const key = Array.from(new Set(ids)).sort().join(",");
  const [result, setResult] = useState<{ key: string; items: EvidenceRecord[] }>();
  useEffect(() => {
    if (!key) return;
    let active = true;
    void readSources(key.split(",")).then((items) => {
      if (active) setResult({ key, items });
    });
    return () => {
      active = false;
    };
  }, [key]);
  const current = result?.key === key ? result : undefined;
  const items = new Map(current?.items.map((source) => [source.id, source]));
  const unresolved = current ? ids.filter((id) => !items.has(id)) : [];
  return {
    items,
    unresolved,
    retry: async () => {
      const recovered = await readSources(unresolved);
      setResult((previous) =>
        previous?.key === key ? { key, items: mergeSources(previous.items, recovered) } : previous,
      );
    },
  };
}

export function useEvidenceLibrary(
  query: string,
  availability?: EvidenceAvailability,
  enabled = true,
) {
  const [generation, setGeneration] = useState(0);
  const [results, setResults] = useState<Results>();
  const [pendingPage, setPendingPage] = useState<Results>();
  const refresh = () => setGeneration((value) => value + 1);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const scope = { query, availability, generation };
    async function load() {
      try {
        const page = await listSources(query, availability);
        if (active) setResults({ scope, page });
      } catch (cause) {
        if (active)
          setResults({
            scope,
            page: { items: [], total: 0 },
            error: cause instanceof Error ? cause.message : "Unable to load evidence.",
          });
      }
    }
    const timer = setTimeout(load, query ? 200 : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [availability, enabled, generation, query]);
  const current =
    enabled &&
    results?.scope.query === query &&
    results.scope.generation === generation &&
    results.scope.availability === availability
      ? results
      : undefined;
  const next = current?.page.next_offset ?? null;
  async function more() {
    if (!current) return;
    if (next === null) {
      refresh();
      return;
    }
    setPendingPage(current);
    try {
      const page = await listSources(query, availability, next);
      setResults((latest) =>
        latest === current
          ? {
              scope: current.scope,
              page: { ...page, items: mergeSources(current.page.items, page.items) },
            }
          : latest,
      );
    } catch (cause) {
      setResults((latest) =>
        latest === current
          ? {
              ...current,
              error: cause instanceof Error ? cause.message : "Unable to load evidence.",
            }
          : latest,
      );
    } finally {
      setPendingPage((pending) => (pending === current ? undefined : pending));
    }
  }
  return {
    items: current?.page.items ?? [],
    total: current?.page.total ?? 0,
    error: current?.error,
    loading: enabled && (!current || pendingPage === current),
    hasMore: next !== null,
    more,
    refresh,
  };
}
