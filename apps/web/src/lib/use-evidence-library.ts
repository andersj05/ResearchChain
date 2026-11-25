import { useEffect, useRef, useState } from "react";
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

function readSource(id: string) {
  return api<EvidenceRecord>(`evidence/${encodeURIComponent(id)}`).catch(() => null);
}

export async function readSources(ids: string[]) {
  return (await Promise.all(ids.map(readSource))).filter((item) => item !== null);
}

const sourceReadLimit = 6;

export function useSourceDetails(ids: string[]) {
  // A packet's order belongs to its renderer. Fetch details for its source set.
  const key = Array.from(new Set(ids)).sort().join(",");
  const [result, setResult] = useState<{
    key: string;
    records: Map<string, EvidenceRecord | null>;
  }>();
  const pending = useRef(new Map<string, ReturnType<typeof readSource>>());
  const reader = useRef<{ key: string; read: (ids: string[]) => Promise<void> }>(null);
  useEffect(() => {
    if (!key) return;
    let active = true;
    // A changing packet may leave requests in flight. Count those against this
    // hook's limit, and share a request when its evidence ID is still needed.
    const requests = pending.current;
    async function read(requested: string[]) {
      let next = 0;
      async function worker() {
        while (active && next < requested.length) {
          const id = requested[next++]!;
          let request = requests.get(id);
          while (active && !request && requests.size >= sourceReadLimit) {
            await Promise.race(requests.values());
            request = requests.get(id);
          }
          if (!active) return;
          if (!request) {
            request = readSource(id).finally(() => requests.delete(id));
            requests.set(id, request);
          }
          const record = await request;
          if (active)
            setResult((previous) => ({
              key,
              records: new Map(previous?.key === key ? previous.records : undefined).set(
                id,
                record,
              ),
            }));
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(sourceReadLimit, requested.length) }, worker),
      );
    }
    reader.current = { key, read };
    void read(key.split(","));
    return () => {
      active = false;
      reader.current = null;
    };
  }, [key]);
  const current = result?.key === key ? result : undefined;
  const items = new Map<string, EvidenceRecord>();
  const unresolved: string[] = [];
  for (const id of ids) {
    const record = current?.records.get(id);
    if (record) items.set(id, record);
    if (record === null) unresolved.push(id);
  }
  return {
    items,
    unresolved,
    retry: async () => {
      if (reader.current?.key === key) await reader.current.read(unresolved);
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
