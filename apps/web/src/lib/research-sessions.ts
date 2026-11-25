import type { components } from "@researchchain/contracts";
import type { ModelOverride, ModelProfile, ProviderModel } from "./model-settings";

export type ResearchSessionSetup = components["schemas"]["ResearchSessionSetup"];
export type ResearchSessionStart = components["schemas"]["ResearchSessionStart"];
export const sourceLedBrief = "Source-led study";
export type SwarmSettings = NonNullable<ResearchSessionSetup["swarm"]>;
export const initialSwarm: Required<SwarmSettings> = {
  lead_count: 2,
  researchers_per_lead: 20,
  max_parallel: 4,
  max_lead_turns: 6,
  allow_consultations: true,
};
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
> &
  Pick<
    ResearchSessionSetup,
    "reasoning_effort" | "verbosity" | "lead" | "researcher" | "editor" | "swarm"
  > &
  Partial<Pick<ResearchSessionSetup, "title" | "start_from_sources" | "max_input_bytes">>;

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

const leadModel = "gpt-6.2-astra";
const researcherModel = "gpt-6.2-sol";

function highSettings(model: ProviderModel): Omit<ModelProfile, "model"> {
  return {
    reasoning_effort: model.reasoning_efforts?.includes("high") ? "high" : null,
    verbosity: model.supports_verbosity ? "high" : null,
  };
}

export function newStudyModelProfiles(models: readonly ProviderModel[], fallback: string) {
  const shared =
    models.find((entry) => entry.slug === researcherModel) ??
    models.find((entry) => entry.slug === fallback) ??
    models[0];
  if (!shared) return null;
  const settings = highSettings(shared);

  function role(model: string): ModelOverride {
    const entry = models.find((item) => item.slug === model);
    if (!entry) return { model };
    const supported = highSettings(entry);
    return {
      model,
      ...(supported.reasoning_effort !== settings.reasoning_effort && {
        reasoning_effort: supported.reasoning_effort ?? "model_default",
      }),
      ...(supported.verbosity !== settings.verbosity && {
        verbosity: supported.verbosity ?? "model_default",
      }),
    };
  }

  return {
    model: shared.slug,
    ...settings,
    lead: role(leadModel),
    researcher: role(researcherModel),
  };
}

export function reusableResearchSettings(source: ResearchSessionSetup) {
  return {
    max_input_bytes: source.max_input_bytes ?? 4_000_000,
    model: source.model,
    reasoning_effort: source.reasoning_effort,
    verbosity: source.verbosity,
    lead: source.lead,
    researcher: source.researcher,
    editor: source.editor,
    swarm: source.swarm,
    max_agents: source.max_agents ?? blankResearchBrief.max_agents,
    max_passes: source.max_passes ?? blankResearchBrief.max_passes,
    max_active_seconds: source.max_active_seconds ?? blankResearchBrief.max_active_seconds,
  };
}

export function editableResearchBrief(source: ResearchSessionSetup): ResearchBrief {
  return {
    ...reusableResearchSettings(source),
    brief: source.start_from_sources && source.brief === sourceLedBrief ? "" : source.brief,
    ...(source.title && { title: source.title }),
    ...(source.start_from_sources && { start_from_sources: true }),
    style_excerpt: source.style_excerpt ?? "",
    evidence_ids: source.evidence_ids ?? [],
    web_search: source.web_search ?? false,
    review_mode: source.review_mode ?? "when_needed",
  };
}

// A tab can keep a new brief and a separate revision of each previous study.
// Keep the exact request until the server confirms admission, including after a reload.
type SavedBrief = {
  draft: ResearchBrief;
  pending: ResearchSessionStart | null;
  awaitingModelCatalog?: true;
};
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export function initializeResearchBrief(saved: SavedBrief | null, fromSession: string | null) {
  const draft = saved?.draft ?? blankResearchBrief;
  // Older desks saved their untouched empty form as soon as it opened. An explicit
  // null role or capability still records an owner choice and adds a key.
  const fields = Object.keys(blankResearchBrief) as (keyof ResearchBrief)[];
  const untouched =
    Object.keys(draft).length === fields.length &&
    fields.every((key) =>
      key === "evidence_ids"
        ? draft.evidence_ids.length === 0
        : draft[key] === blankResearchBrief[key],
    );
  const awaitingModelCatalog =
    !fromSession && !saved?.pending && (!saved || !!saved.awaitingModelCatalog || untouched);
  return {
    draft: awaitingModelCatalog
      ? { ...draft, lead: { model: leadModel }, researcher: { model: researcherModel } }
      : draft,
    awaitingModelCatalog,
  };
}

function validDraft(value: ResearchBrief) {
  return (
    value &&
    typeof value.brief === "string" &&
    (value.title == null || (typeof value.title === "string" && value.title.length <= 160)) &&
    (value.start_from_sources === undefined || typeof value.start_from_sources === "boolean") &&
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
    return {
      draft: record.draft,
      pending: pending ?? null,
      ...(record.awaitingModelCatalog === true && { awaitingModelCatalog: true }),
    };
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
