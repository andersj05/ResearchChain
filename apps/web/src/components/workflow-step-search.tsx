import { useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@ui-sdk/react/button";
import { nodePresentation } from "@/components/node-kind";
import {
  reachableWorkflowGraphs,
  scopeKey,
  type GraphCrumb,
  type GraphScope,
} from "@/lib/workflow-editing";
import type { Workflow, WorkflowNode } from "@/lib/workflow";

type StepFilter = "all" | "review" | "research";

function findSteps(workflow: Workflow, query: string, filter: StepFilter) {
  const results: { node: WorkflowNode; path: GraphCrumb[]; location: string; relevance: number }[] =
    [];
  for (const { graph, path } of reachableWorkflowGraphs(workflow)) {
    const version = path.at(-1)?.ref.version;
    const location = version ? `${graph.name} · v${version}` : graph.name;
    for (const node of graph.nodes) {
      if (filter !== "all" && node.kind !== filter) continue;
      const model =
        node.config?.type === "research"
          ? (node.config.model ?? workflow.research?.model)
          : undefined;
      if (
        !query ||
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
        const relevance =
          !query || label === query || node.id === query ? 0 : label.includes(query) ? 1 : 2;
        results.push({ node, path, location, relevance });
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
  palette,
  children,
}: {
  workflow: Workflow;
  scope: GraphScope;
  selected: string;
  onSelect: (id: string, path: GraphCrumb[]) => void;
  palette: ReactNode;
  children: ReactNode;
}) {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StepFilter>("all");
  const [visibleLimit, setVisibleLimit] = useState(pageSize);
  const resultList = useRef<HTMLOListElement>(null);
  const query = search.trim().toLowerCase();
  const searching = !!query || filter !== "all";
  const results = searching ? findSteps(workflow, query, filter) : [];
  function resetMatchingPage() {
    setVisibleLimit(pageSize);
    if (resultList.current) resultList.current.scrollTop = 0;
  }
  function changeSearch(value: string) {
    setSearch(value);
    resetMatchingPage();
  }
  return (
    <>
      <div className="step-search">
        <div className="step-search-heading">
          <label htmlFor={searchId}>Find a step</label>
          <select
            aria-label="Filter steps by type"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value as StepFilter);
              resetMatchingPage();
            }}
          >
            <option value="all">All steps</option>
            <option value="review">Reviews</option>
            <option value="research">Model steps</option>
          </select>
        </div>
        <input
          id={searchId}
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
      </div>
      {searching && (
        <>
          <p className="field-hint" role="status">
            {!results.length
              ? "No matching steps."
              : results.length > visibleLimit
                ? `${visibleLimit} of ${results.length} matches`
                : `${results.length} ${results.length === 1 ? "match" : "matches"}`}
          </p>
          <ol
            ref={resultList}
            className="node-outline step-search-results"
            aria-label="Matching steps"
          >
            {results.slice(0, visibleLimit).map(({ node, path, location }) => {
              const resultScope = scopeKey(path.at(-1)?.ref ?? null);
              const kind = nodePresentation(node).shortLabel;
              return (
                <li key={`${resultScope}/${node.id}`}>
                  <Button
                    className="outline-row step-search-result"
                    aria-pressed={resultScope === scopeKey(scope) && node.id === selected}
                    onClick={() => onSelect(node.id, path)}
                  >
                    <span className="outline-label">{node.label}</span>
                    {kind.toLowerCase() !== node.label.trim().toLowerCase() && (
                      <span className={`outline-kind kind-${node.kind}`}>{kind}</span>
                    )}
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
      )}
      {palette}
      {!searching && children}
    </>
  );
}
