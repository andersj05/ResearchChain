import type { Workflow, WorkflowNode } from "./workflow";

// Editing conveniences for the current single-chain contract. The API remains
// responsible for validation, including drafts that were already disconnected.
export function insertStep(workflow: Workflow, step: WorkflowNode, selected: string): Workflow {
  const anchor =
    workflow.nodes.find((node) => node.id === selected) ??
    workflow.nodes.find((node) => node.kind === "finish");
  if (!anchor) return { ...workflow, nodes: [...workflow.nodes, step] };

  const before = anchor.kind === "finish";
  const adjacent = workflow.edges.filter((edge) =>
    before ? edge.target === anchor.id : edge.source === anchor.id,
  );
  const index = workflow.nodes.indexOf(anchor) + (before ? 0 : 1);
  const nodes = [...workflow.nodes];
  // Place the new step in an unused row without moving the existing diagram.
  const positioned = {
    ...step,
    position: {
      x: anchor.position.x,
      y: Math.max(...workflow.nodes.map((node) => node.position.y)) + 180,
    },
  };
  nodes.splice(index, 0, positioned);
  if (adjacent.length > 1) return { ...workflow, nodes };
  const edges = workflow.edges.filter((edge) => !adjacent.includes(edge));
  if (before) {
    if (adjacent[0]) edges.push({ source: adjacent[0].source, target: step.id });
    edges.push({ source: step.id, target: anchor.id });
  } else {
    edges.push({ source: anchor.id, target: step.id });
    if (adjacent[0]) edges.push({ source: step.id, target: adjacent[0].target });
  }
  return {
    ...workflow,
    nodes,
    edges,
    start_node: before && workflow.start_node === anchor.id ? step.id : workflow.start_node,
  };
}

export function removeStep(workflow: Workflow, id: string): Workflow {
  const incoming = workflow.edges.filter((edge) => edge.target === id);
  const outgoing = workflow.edges.filter((edge) => edge.source === id);
  const edges = workflow.edges.filter((edge) => edge.source !== id && edge.target !== id);
  const previous = incoming.length === 1 ? incoming[0] : undefined;
  const next = outgoing.length === 1 ? outgoing[0] : undefined;
  if (previous && next && previous.source !== next.target) {
    const replacement = { source: previous.source, target: next.target };
    if (
      !edges.some(
        (edge) => edge.source === replacement.source && edge.target === replacement.target,
      )
    )
      edges.push(replacement);
  }
  return {
    ...workflow,
    nodes: workflow.nodes.filter((node) => node.id !== id),
    edges,
    start_node: workflow.start_node === id && next ? next.target : workflow.start_node,
  };
}
