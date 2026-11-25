import { useEffect, useEffectEvent, useRef, useState } from "react";
import { apiFetch } from "@/lib/access";
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

async function readSource(id: string, signal?: AbortSignal): Promise<EvidenceRecord | null> {
  try {
    const timeout = AbortSignal.timeout(15000);
    const response = await apiFetch(`/api/evidence/${encodeURIComponent(id)}`, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    return response.ok ? ((await response.json()) as EvidenceRecord) : null;
  } catch {
    return null;
  }
}

export async function readSources(ids: string[]) {
  return (await Promise.all(ids.map((id) => readSource(id)))).filter((item) => item !== null);
}

const sourceReadLimit = 6;

type SourceRequest = { id: string };
type SourceScope = {
  key: string;
  ownerSession?: symbol | null;
  sources: Map<string, SourceRequest>;
  records: Map<string, EvidenceRecord | null>;
};
type PendingSource = {
  ownerSession?: symbol | null;
  controller: AbortController;
  promise: ReturnType<typeof readSource>;
};

function sourceScope(
  key: string,
  ownerSession?: symbol | null,
  previous?: SourceScope,
): SourceScope {
  const retained = ownerSession && ownerSession === previous?.ownerSession ? previous : undefined;
  const sources = new Map<string, SourceRequest>();
  const records = new Map<string, EvidenceRecord | null>();
  for (const id of key ? key.split(",") : []) {
    sources.set(id, retained?.sources.get(id) ?? { id });
    const record = retained?.records.get(id);
    if (record !== undefined) records.set(id, record);
  }
  return { key, ownerSession, sources, records };
}

export function useSourceDetails(ids: string[], ownerSession?: symbol | null) {
  // A packet's order belongs to its renderer. Fetch details for its source set.
  const key = ownerSession === null ? "" : Array.from(new Set(ids)).sort().join(",");
  const [scope, setScope] = useState(() => sourceScope(key, ownerSession));
  if (scope.key !== key || scope.ownerSession !== ownerSession)
    setScope(sourceScope(key, ownerSession, scope));
  const pending = useRef(new Map<string | SourceRequest, PendingSource>());
  const reader = useRef<{
    key: string;
    ownerSession?: symbol | null;
    read: (sources: SourceRequest[]) => Promise<void>;
  }>(null);
  const refreshOnReveal = useRef(false);
  const getScope = useEffectEvent(() => scope);

  // Activity pauses effects without discarding the owner's draft. Recheck
  // availability on reveal, even when the selected packet has not changed.
  useEffect(
    () => () => {
      refreshOnReveal.current = true;
    },
    [],
  );

  useEffect(() => {
    const requests = pending.current;
    for (const request of requests.values()) {
      if (request.ownerSession !== ownerSession) request.controller.abort();
    }
    if (!key) return;
    let active = true;
    const current = getScope();
    const revalidate = ownerSession === undefined || refreshOnReveal.current;
    refreshOnReveal.current = false;

    async function read(requested: SourceRequest[]) {
      let next = 0;
      async function worker() {
        while (active && next < requested.length) {
          const source = requested[next++]!;
          const { id } = source;
          // A source that leaves the packet gets a new request identity on
          // re-add. Requests for unrelated, unchanged sources can still finish.
          const requestKey = ownerSession === undefined ? id : source;
          let request = requests.get(requestKey);
          while (active && !request && requests.size >= sourceReadLimit) {
            await Promise.race([...requests.values()].map(({ promise }) => promise));
            request = requests.get(requestKey);
          }
          if (!active) return;
          if (!request) {
            const controller = new AbortController();
            const promise = readSource(id, controller.signal).finally(() =>
              requests.delete(requestKey),
            );
            request = { ownerSession, controller, promise };
            requests.set(requestKey, request);
          }
          const record = await request.promise;
          if (request.controller.signal.aborted) continue;
          setScope((latest) => {
            const matches =
              ownerSession === undefined
                ? active && latest.key === key
                : latest.ownerSession === ownerSession && latest.sources.get(id) === source;
            if (!matches || latest.records.get(id) === record) return latest;
            return { ...latest, records: new Map(latest.records).set(id, record) };
          });
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(sourceReadLimit, requested.length) }, worker),
      );
    }
    reader.current = { key, ownerSession, read };
    void read(
      [...current.sources.values()].filter(({ id }) => revalidate || !current.records.has(id)),
    );
    return () => {
      active = false;
      reader.current = null;
    };
  }, [key, ownerSession]);
  const current = scope.key === key && scope.ownerSession === ownerSession ? scope : undefined;
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
      if (reader.current?.key !== key || reader.current.ownerSession !== ownerSession) return;
      await reader.current.read(
        unresolved.flatMap((id) => {
          const source = current?.sources.get(id);
          return source ? [source] : [];
        }),
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
