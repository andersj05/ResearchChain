import type { AgentSummary, RunRequest, Workflow, WorkflowRevision } from "./workflow";

export type AgentDraft = {
  agent: AgentSummary | null;
  revision: WorkflowRevision | null;
  workflow: Workflow;
  brief: string;
  evidenceIds: string[];
  artifacts: RunRequest["artifacts"];
  providerAccount: string | null;
};
export const agentDraftKey = (prefix: string, id: string) => `${prefix}.agent-draft.${id}`;
export function readAgentDraft(prefix: string, id: string): AgentDraft | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(agentDraftKey(prefix, id)) ?? "null",
    ) as AgentDraft | null;
    if (
      !value ||
      value.agent?.id !== id ||
      !Number.isInteger(value.agent.version) ||
      !value.workflow ||
      typeof value.workflow.name !== "string" ||
      !Array.isArray(value.workflow.nodes) ||
      !Array.isArray(value.workflow.edges) ||
      typeof value.brief !== "string" ||
      !Array.isArray(value.evidenceIds)
    )
      return null;
    if (
      value.workflow.nodes.some(
        (node) =>
          typeof node.id !== "string" ||
          typeof node.label !== "string" ||
          typeof node.kind !== "string" ||
          !Number.isFinite(node.position?.x) ||
          !Number.isFinite(node.position?.y),
      )
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
