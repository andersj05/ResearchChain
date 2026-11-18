import { pendingReviews } from "./run-inspection";
import type { RunSnapshot } from "./workflow";

const terminalStatuses = new Set(["completed", "rejected", "cancelled", "failed", "limited"]);

export function readReviewDrafts(key: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([, text]) => typeof text === "string" && text.length <= 6000),
    );
  } catch {
    return {};
  }
}

export function pruneReviewDrafts(run: RunSnapshot, drafts: Record<string, string>) {
  const entries = Object.entries(drafts);
  if (!entries.length) return drafts;
  if (terminalStatuses.has(run.status)) return {};
  const open =
    run.status === "paused" && !run.execution_pending
      ? new Set(pendingReviews(run).map((review) => review.interrupt_id))
      : null;
  const remaining = entries.filter(([id, text]) => text && (!open || open.has(id)));
  return remaining.length === entries.length ? drafts : Object.fromEntries(remaining);
}

export function storeReviewDrafts(key: string, drafts: string) {
  try {
    if (drafts === "{}") sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, drafts);
  } catch {
    // The editor keeps the draft in memory when browser storage is unavailable.
  }
}
