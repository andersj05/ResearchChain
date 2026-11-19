import { apiFetch } from "@/lib/access";
import type { components } from "@researchchain/contracts";
import chartSignalExample from "../../../../examples/chart-signal.json";
import chartSignalBriefLines from "../../../../examples/chart-signal-brief.json";
import discretionaryMacroExample from "../../../../examples/discretionary-macro.json";
import discretionaryMacroBriefLines from "../../../../examples/discretionary-macro-brief.json";
import equityCatsExample from "../../../../examples/equitycats-research.json";
import equityCatsBriefLines from "../../../../examples/equitycats-research-brief.json";
import ideaGenerationExample from "../../../../examples/idea-generation.json";
import ideaGenerationBriefLines from "../../../../examples/idea-generation-brief.json";
import ideaExample from "../../../../examples/idea-research.json";
import researchExample from "../../../../examples/hypothesis-research.json";
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
export type RecentRunSummary = components["schemas"]["RecentRunSummary"];
export type RunArchivePage = components["schemas"]["RunArchivePage"];
export type PendingReviewsPage = components["schemas"]["PendingReviewsPage"];
export type RunRequest = components["schemas"]["RunRequest"];
export type CommandReceipt = components["schemas"]["CommandReceipt"];
export type RevisionSummary = components["schemas"]["RevisionSummary"] & { agent_version?: number };
export type AgentSummary = components["schemas"]["AgentSummary"];
export type AgentDetail = components["schemas"]["AgentDetail"];
export type AgentVersion = components["schemas"]["AgentVersion"];
export type WorkflowRevision = components["schemas"]["WorkflowRevision"];
export type ValidationResult = components["schemas"]["ValidationResult"];

export const defaultReviewQuestion = "Continue this workflow?";
export const exampleWorkflow = example as Workflow;
export const initialWorkflow: Workflow = {
  schema_version: "0.2",
  name: "Untitled workflow",
  start_node: "finish",
  nodes: [
    {
      id: "finish",
      kind: "finish",
      label: "Finish",
      instructions: "",
      position: { x: 360, y: 160 },
    },
  ],
  edges: [],
};
export const ideaWorkflow = ideaExample as Workflow;
export const ideaGenerationWorkflow = ideaGenerationExample as Workflow;
export const ideaGenerationBrief = ideaGenerationBriefLines.join("\n");
export const discretionaryMacroWorkflow = discretionaryMacroExample as Workflow;
export const discretionaryMacroBrief = discretionaryMacroBriefLines.join("\n");
export const chartSignalWorkflow = chartSignalExample as Workflow;
export const chartSignalBrief = chartSignalBriefLines.join("\n");
export const equityCatsWorkflow = equityCatsExample as Workflow;
export const equityCatsBrief = equityCatsBriefLines.join("\n");
export const researchWorkflow = researchExample as Workflow;
export type ResearchSettings = components["schemas"]["ResearchSettings"];
export type ResearchLimits = components["schemas"]["ResearchLimits"];
export type ProviderStatus = components["schemas"]["ProviderStatus"];
export const researchDefaults = {
  ...researchWorkflow.research!,
  limits: researchExample.research.limits,
};
export const admissionTimeout = 30000;

export type ValidationIssue = { location: (string | number)[]; path: string; message: string };
export class ApiError extends Error {
  constructor(
    message: string,
    readonly issues: ValidationIssue[] = [],
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, body?: unknown, timeout = 15000): Promise<T> {
  const response = await apiFetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = payload?.detail;
    const message = Array.isArray(detail)
      ? detail.map((item: { msg: string }) => item.msg).join(" ")
      : typeof detail === "string"
        ? detail
        : "The local API is unavailable. Start the local services with pnpm dev.";
    const issues: ValidationIssue[] = Array.isArray(detail)
      ? detail.map((item: { loc?: (string | number)[]; msg: string }) => ({
          location: item.loc ?? [],
          path: (item.loc ?? []).filter((part) => part !== "body").join("."),
          message: item.msg,
        }))
      : [];
    throw new ApiError(message, issues, response.status);
  }
  return response.json() as Promise<T>;
}
