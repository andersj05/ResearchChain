import type { components } from "@researchchain/contracts";
import example from "../../../../examples/research-workflow.json";

export type Workflow = components["schemas"]["Workflow"];
export type WorkflowNode = components["schemas"]["WorkflowNode"];
export type RunSnapshot = components["schemas"]["RunSnapshot"];
export type RunSummary = components["schemas"]["RunSummary"];
export type RunRequest = components["schemas"]["RunRequest"];
export type RevisionSummary = components["schemas"]["RevisionSummary"];
export type WorkflowRevision = components["schemas"]["WorkflowRevision"];
export type ValidationResult = components["schemas"]["ValidationResult"];

export const initialWorkflow = example as Workflow;

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = payload?.detail;
    const message = Array.isArray(detail)
      ? detail.map((item: { msg: string }) => item.msg).join(" ")
      : typeof detail === "string"
        ? detail
        : "The local API is unavailable. Start both services with pnpm dev.";
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
