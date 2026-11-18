import { useState, type ReactNode } from "react";
import { Button } from "@ui-sdk/react/button";
import { nodePresentation } from "@/components/node-kind";
import { graphAt, referenceOf, scopeKey, type GraphScope } from "@/lib/workflow-editing";
import type { Graph, SubgraphRef, Workflow, WorkflowNode } from "@/lib/workflow";

export type GraphCrumb = { ref: SubgraphRef; via: string };

function findSteps(workflow: Workflow, query: string) {
  // A shared definition needs one editable destination. Visit the shortest valid
  // path first, even when several draft nodes reference the same definition.
  const graphs: { graph: Graph; path: GraphCrumb[] }[] = [{ graph: workflow, path: [] }];
  const visited = new Set<string>();
  const results: { node: WorkflowNode; path: GraphCrumb[]; location: string; relevance: number }[] =
    [];
  for (const { graph, path } of graphs) {
    const version = path.at(-1)?.ref.version;
    const location = version ? `${graph.name} · v${version}` : graph.name;
    for (const node of graph.nodes) {
      const model =
        node.config?.type === "research"
          ? (node.config.model ?? workflow.research?.model)
          : undefined;
      if (
        [
          node.label,
          node.id,
          node.instructions,
          nodePresentation(node).label,
          location,
          model,
        ].some((value) => value?.toLowerCase().includes(query))
      ) {
        const label = node.label.toLowerCase();
        const relevance = label === query || node.id === query ? 0 : label.includes(query) ? 1 : 2;
        results.push({ node, path, location, relevance });
      }
      const ref = referenceOf(node);
      if (!ref || path.length >= 8 || visited.has(scopeKey(ref))) continue;
      const body = graphAt(workflow, ref);
      if (body) {
        visited.add(scopeKey(ref));
        graphs.push({ graph: body, path: [...path, { ref, via: node.id }] });
      }
    }
  }
  return results.sort((left, right) => left.relevance - right.relevance);
}

const pageSize = 30;

export function WorkflowStepSearch({
  workflow,
  scope,
  selected,
  onSelect,
  children,
}: {
  workflow: Workflow;
  scope: GraphScope;
  selected: string;
  onSelect: (id: string, path: GraphCrumb[]) => void;
  children: ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(pageSize);
  const query = search.trim().toLowerCase();
  const results = query ? findSteps(workflow, query) : [];
  function changeSearch(value: string) {
    setSearch(value);
    setVisibleLimit(pageSize);
  }
  return (
    <>
      <label className="step-search">
        Find a step
        <input
          type="search"
          value={search}
          placeholder="Name, instructions, or model"
          onChange={(event) => changeSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && search) {
              event.preventDefault();
              changeSearch("");
            }
            if (event.key === "Enter" && results[0]) {
              event.preventDefault();
              onSelect(results[0].node.id, results[0].path);
            }
          }}
        />
      </label>
      {query ? (
        <>
          <p className="field-hint" role="status">
            {!results.length
              ? "No steps match this search."
              : results.length > visibleLimit
                ? `${visibleLimit} of ${results.length} matches`
                : `${results.length} ${results.length === 1 ? "match" : "matches"}`}
          </p>
          <ol className="node-outline" aria-label="Matching steps">
            {results.slice(0, visibleLimit).map(({ node, path, location }) => {
              const resultScope = scopeKey(path.at(-1)?.ref ?? null);
              return (
                <li key={`${resultScope}/${node.id}`}>
                  <Button
                    className="outline-row step-search-result"
                    aria-pressed={resultScope === scopeKey(scope) && node.id === selected}
                    onClick={() => onSelect(node.id, path)}
                  >
                    <span className="outline-label">{node.label}</span>
                    <span className={`outline-kind kind-${node.kind}`}>
                      {nodePresentation(node).shortLabel}
                    </span>
                    <small>{location}</small>
                  </Button>
                </li>
              );
            })}
          </ol>
          {results.length > visibleLimit && (
            <button
              type="button"
              className="button small"
              onClick={() => setVisibleLimit(visibleLimit + pageSize)}
            >
              Show more matches
            </button>
          )}
        </>
      ) : (
        children
      )}
    </>
  );
}
