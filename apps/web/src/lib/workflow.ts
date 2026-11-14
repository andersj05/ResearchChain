import type { components } from "@researchchain/contracts";
import example from "../../../../examples/research-workflow.json";

export type Workflow = components["schemas"]["Workflow"];
export type WorkflowNode = components["schemas"]["WorkflowNode"];
export type WorkflowEdge = components["schemas"]["WorkflowEdge"];
export type Graph = Pick<Workflow, "name" | "start_node" | "nodes" | "edges">;
export type SubgraphRef = components["schemas"]["SubgraphRef"];
export type SubgraphDefinition = components["schemas"]["SubgraphDefinition"];
export type ValueSource = components["schemas"]["ValueSource"];
export type Predicate = components["schemas"]["Predicate"];
export type NodeTypeSpec = components["schemas"]["NodeTypeSpec"];
export type ExecutionBudgets = components["schemas"]["ExecutionBudgets"];
export type RunSnapshot = components["schemas"]["RunSnapshot"];
export type RunSummary = components["schemas"]["RunSummary"];
export type RunRequest = components["schemas"]["RunRequest"];
export type RevisionSummary = components["schemas"]["RevisionSummary"];
export type WorkflowRevision = components["schemas"]["WorkflowRevision"];
export type ValidationResult = components["schemas"]["ValidationResult"];

export const initialWorkflow = example as Workflow;

export type ValidationIssue = { path: string; message: string };
export class ApiError extends Error {
  constructor(
    message: string,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

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
    const issues: ValidationIssue[] = Array.isArray(detail)
      ? detail.map((item: { loc?: (string | number)[]; msg: string }) => ({
          path: (item.loc ?? []).filter((part) => part !== "body").join("."),
          message: item.msg,
        }))
      : [];
    throw new ApiError(message, issues);
  }
  return response.json() as Promise<T>;
}
