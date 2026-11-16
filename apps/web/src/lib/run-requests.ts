import type { RunRequest } from "@/lib/workflow";

// Per-tab retry identity survives refresh and is scoped to the authenticated owner.
export function readPendingRun(key: string): RunRequest | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw || raw.length > 30000) return null;
    const value = JSON.parse(raw) as RunRequest;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (
      typeof value?.id !== "string" ||
      !uuid.test(value.id) ||
      typeof value.revision_id !== "string" ||
      !uuid.test(value.revision_id) ||
      (value.agent_id != null &&
        (typeof value.agent_id !== "string" || !uuid.test(value.agent_id))) ||
      typeof value.brief !== "string" ||
      !Array.isArray(value.artifacts) ||
      !Array.isArray(value.evidence_ids) ||
      value.evidence_ids.length > 100 ||
      value.evidence_ids.some((id) => typeof id !== "string" || !uuid.test(id)) ||
      (value.provider_account_id != null && typeof value.provider_account_id !== "string")
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

export function retainPendingRun(key: string, value: RunRequest) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The in-memory request and run URL still preserve retries in the open page.
  }
}

export function forgetPendingRun(key: string, id: string) {
  try {
    if (readPendingRun(key)?.id === id) sessionStorage.removeItem(key);
  } catch {
    // Browser storage may be unavailable; never erase another pending request.
  }
}
