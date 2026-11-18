import { reachableWorkflowGraphs, referenceOf, type GraphCrumb } from "@/lib/workflow-editing";
import type { SubgraphRef, Workflow } from "@/lib/workflow";

export function DefinitionReferences({
  workflow,
  definition,
  disabled,
  onOpen,
}: {
  workflow: Workflow;
  definition: SubgraphRef;
  disabled: boolean;
  onOpen: (id: string, path: GraphCrumb[]) => void;
}) {
  const reachable = new Map(
    Array.from(
      reachableWorkflowGraphs(workflow, { controlOnly: true }),
      (entry) => [entry.graph, entry] as const,
    ),
  );
  const references = [workflow, ...(workflow.subgraphs ?? [])].flatMap((graph, graphIndex) => {
    const entry = reachable.get(graph);
    const location = "version" in graph ? `${graph.name} · v${graph.version}` : "Root workflow";
    return graph.nodes.flatMap((step, stepIndex) => {
      const ref = referenceOf(step);
      if (ref?.id !== definition.id || ref.version !== definition.version) return [];
      const ambiguous = graph.nodes.some(
        (candidate, index) => candidate.id === step.id && index !== stepIndex,
      );
      const path = entry && entry.nodes.includes(step) && !ambiguous ? entry.path : undefined;
      return [
        {
          key: `${graphIndex}/${stepIndex}`,
          step,
          location,
          path,
          ambiguous,
        },
      ];
    });
  });

  return (
    <details className="definition-references">
      <summary>
        Used by{" "}
        <small>
          {references.length} draft {references.length === 1 ? "reference" : "references"}
        </small>
      </summary>
      <ul aria-label="References to this definition version">
        {references.map(({ key, step, location, path, ambiguous }) => {
          const label = step.label || step.id;
          return (
            <li key={key}>
              <span>{label}</span>
              <small>{location}</small>
              {path ? (
                <button
                  type="button"
                  aria-label={`Open step ${label} in ${location}`}
                  disabled={disabled}
                  onClick={() => onOpen(step.id, path)}
                >
                  Open step
                </button>
              ) : (
                <small>{ambiguous ? "Ambiguous step ID" : "Outside reachable workflow"}</small>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
