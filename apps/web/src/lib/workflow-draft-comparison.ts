import {
  changedSettings,
  compareWorkflowGraphs,
  sameWorkflowDocument,
} from "./workflow-comparison";
import type { Workflow, WorkflowNode } from "./workflow";

function workflowSettings(workflow: Workflow) {
  const { budgets, research } = workflow;
  const limits = research?.limits;
  return {
    "Workflow format": workflow.schema_version,
    "Maximum step executions": budgets?.max_node_executions,
    "Maximum active seconds": budgets?.max_active_seconds,
    "Maximum parallel steps": budgets?.max_concurrency,
    "Research provider": research?.provider === "chatgpt_plan" ? "ChatGPT plan" : undefined,
    "Workflow model": research?.model,
    "Model attempts allowed": limits?.max_model_calls,
    "Evidence reads allowed": limits?.max_tool_calls,
    "Total tokens allowed":
      limits?.max_total_tokens === "as_needed" ? "As needed" : limits?.max_total_tokens,
    "Bytes per request": limits?.max_input_bytes,
    "Characters per response": limits?.max_output_characters,
    "Seconds per response": limits?.max_response_seconds,
  };
}

function withoutPositions(workflow: Workflow) {
  const omitPositions = (nodes: WorkflowNode[]) =>
    nodes.map((node) =>
      Object.fromEntries(Object.entries(node).filter(([key]) => key !== "position")),
    );
  return {
    ...workflow,
    nodes: omitPositions(workflow.nodes),
    subgraphs: workflow.subgraphs?.map((graph) => ({
      ...graph,
      nodes: omitPositions(graph.nodes),
    })),
  };
}

export function compareWorkflowDraft(saved: Workflow, draft: Workflow) {
  if (sameWorkflowDocument(saved, draft)) return { kind: "matched" } as const;
  if (sameWorkflowDocument(withoutPositions(saved), withoutPositions(draft)))
    return { kind: "layout" } as const;

  const settings = changedSettings(workflowSettings(saved), workflowSettings(draft));
  const graphs = compareWorkflowGraphs(saved, draft, { readableWiring: true });
  return settings.length || graphs.length
    ? ({ kind: "settings", settings, graphs } as const)
    : ({ kind: "other" } as const);
}
