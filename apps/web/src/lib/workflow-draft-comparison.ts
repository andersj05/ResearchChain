import {
  changedSettings,
  compareWorkflowGraphs,
  sameWorkflowDocument,
} from "./workflow-comparison";
import type { Graph, Workflow, WorkflowNode } from "./workflow";
import type { GraphScope } from "./workflow-editing";

export type DraftTextRestoration = {
  graph: Graph;
  step: WorkflowNode;
  savedText: string;
  field: "Instructions" | "Review question";
};

export function draftTextRestoration(
  saved: Workflow,
  beforeScope: GraphScope,
  draftGraph: Graph,
  id: string,
): DraftTextRestoration | undefined {
  const savedGraphs = beforeScope
    ? saved.subgraphs?.filter(
        (graph) => graph.id === beforeScope.id && graph.version === beforeScope.version,
      )
    : [saved];
  if (savedGraphs?.length !== 1) return;
  const previous = savedGraphs[0]!.nodes.filter((node) => node.id === id);
  const current = draftGraph.nodes.filter((node) => node.id === id);
  if (previous.length !== 1 || current.length !== 1) return;
  const before = previous[0]!;
  const step = current[0]!;
  const savedText = before.instructions ?? "";
  if (before.kind !== step.kind || step.kind === "code" || savedText === (step.instructions ?? ""))
    return;
  return {
    graph: draftGraph,
    step,
    savedText,
    field: step.kind === "review" ? "Review question" : "Instructions",
  };
}

export function applyDraftTextRestoration(
  draft: Workflow,
  { graph, step, savedText }: DraftTextRestoration,
): Workflow | undefined {
  const nodes = graph.nodes.map((node) =>
    node === step ? { ...node, instructions: savedText } : node,
  );
  if (graph === draft) return { ...draft, nodes };
  if (!draft.subgraphs?.some((body) => body === graph)) return;
  return {
    ...draft,
    subgraphs: draft.subgraphs.map((body) => (body === graph ? { ...body, nodes } : body)),
  };
}

function workflowSettings(workflow: Workflow) {
  const { budgets, research } = workflow;
  const limits = research?.limits;
  return {
    "Workflow format": workflow.schema_version,
    "Maximum step executions": budgets?.max_node_executions,
    "Maximum active seconds":
      budgets?.max_active_seconds === null ? "No limit" : budgets?.max_active_seconds,
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
