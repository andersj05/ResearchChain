import type { RunSummary } from "@/lib/workflow";

export const runStatusLabels = {
  queued: "Queued",
  paused: "Needs review",
  running: "Running",
  completed: "Completed",
  rejected: "Rejected",
  interrupted: "Needs recovery",
  cancelled: "Cancelled",
  limited: "Limit reached",
  failed: "Needs attention",
};

export function RunStatus({
  status,
  announce = false,
}: {
  status: RunSummary["status"];
  announce?: boolean;
}) {
  return (
    <span
      className={`run-status status-${status}`}
      role={announce ? "status" : undefined}
      aria-label={announce ? "Run status" : undefined}
    >
      <i aria-hidden="true" />
      {runStatusLabels[status]}
    </span>
  );
}

export function formatTime(value: string, includeYear = false) {
  return new Date(value).toLocaleString(undefined, {
    year: includeYear ? "numeric" : undefined,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
