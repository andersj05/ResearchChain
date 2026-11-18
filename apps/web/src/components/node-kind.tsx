import type { WorkflowNode } from "@/lib/workflow";

export const nodeKinds = {
  research: { label: "Hypothesis research", shortLabel: "Research" },
  code: { label: "Custom code", shortLabel: "Code" },
  note: { label: "Research note", shortLabel: "Note" },
  review: {
    label: "Human review",
    shortLabel: "Review",
  },
  route: { label: "Condition", shortLabel: "Condition" },
  fork: { label: "Parallel branches", shortLabel: "Parallel" },
  join: { label: "Join", shortLabel: "Join" },
  loop: { label: "Bounded loop", shortLabel: "Loop" },
  subgraph: { label: "Subgraph", shortLabel: "Subgraph" },
  finish: { label: "Finish", shortLabel: "Finish" },
};

export function nodePresentation(node: WorkflowNode) {
  if (node.config?.type === "research" && node.config.analyst) {
    if (node.config.analyst.workspace)
      return { label: "Research workspace", shortLabel: "Workspace" };
    return { label: "Codex analyst", shortLabel: "Analyst" };
  }
  return node.config?.type === "research" && node.config.stage === "custom"
    ? { label: "Model prompt", shortLabel: "Model" }
    : nodeKinds[node.kind];
}
