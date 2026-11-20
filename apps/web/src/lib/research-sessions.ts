import type { components } from "@researchchain/contracts";

export type ResearchSessionSetup = components["schemas"]["ResearchSessionSetup"];
export type ResearchSessionStart = components["schemas"]["ResearchSessionStart"];
export type ResearchBrief = Required<
  Pick<
    ResearchSessionSetup,
    | "brief"
    | "style_excerpt"
    | "model"
    | "evidence_ids"
    | "max_agents"
    | "max_passes"
    | "max_active_seconds"
    | "web_search"
    | "review_mode"
  >
>;

export const blankResearchBrief: ResearchBrief = {
  brief: "",
  style_excerpt: "",
  model: "",
  evidence_ids: [],
  max_agents: 3,
  max_passes: 6,
  max_active_seconds: 1800,
  web_search: false,
  review_mode: "when_needed",
};

export function editableResearchBrief(source: ResearchSessionSetup): ResearchBrief {
  return {
    brief: source.brief,
    style_excerpt: source.style_excerpt ?? "",
    model: source.model,
    evidence_ids: source.evidence_ids ?? [],
    max_agents: source.max_agents ?? blankResearchBrief.max_agents,
    max_passes: source.max_passes ?? blankResearchBrief.max_passes,
    max_active_seconds: source.max_active_seconds ?? blankResearchBrief.max_active_seconds,
    web_search: source.web_search ?? false,
    review_mode: source.review_mode ?? "when_needed",
  };
}

// A tab can keep a new brief and a separate revision of each previous study.
// Keep the exact request until the server confirms admission, including after a reload.
type SavedBrief = { draft: ResearchBrief; pending: ResearchSessionStart | null };
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

function validDraft(value: ResearchBrief) {
  return (
    value &&
    typeof value.brief === "string" &&
    value.brief.length <= 10000 &&
    typeof value.style_excerpt === "string" &&
    value.style_excerpt.length <= 32000 &&
    typeof value.model === "string" &&
    Array.isArray(value.evidence_ids) &&
    value.evidence_ids.length <= 100 &&
    value.evidence_ids.every((id) => typeof id === "string" && uuid.test(id)) &&
    [value.max_agents, value.max_passes, value.max_active_seconds].every(Number.isInteger) &&
    typeof value.web_search === "boolean" &&
    ["when_needed", "always", "never"].includes(value.review_mode)
  );
}

export function readResearchBrief(key: string): SavedBrief | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw || raw.length > 650000) return null;
    const record: SavedBrief = JSON.parse(raw);
    if (!validDraft(record.draft)) return null;
    const pending = record.pending;
    if (
      pending &&
      (!uuid.test(pending.id) ||
        typeof pending.provider_account_id !== "string" ||
        !validDraft(editableResearchBrief(pending)))
    )
      return null;
    return { draft: record.draft, pending: pending ?? null };
  } catch {
    return null;
  }
}

export function storeResearchBrief(key: string, value: SavedBrief | null) {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch {
    // Edits and the admission ID remain available in memory in this tab.
  }
}

export function sessionUrl(id: string) {
  return `/?session=${encodeURIComponent(id)}`;
}
