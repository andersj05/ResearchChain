import { graphAt, referenceOf, scopeKey } from "./workflow-editing";
import type { Graph, Workflow, WorkflowNode } from "./workflow";

export type SettingChange = { name: string; before?: string; after?: string };

type StepChange = {
  id: string;
  label: string;
  status: "Added" | "Removed" | "Changed";
  settings: SettingChange[];
};

type GraphChange = { key: string; label: string; settings: SettingChange[]; steps: StepChange[] };

function orderedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, orderedValue(item)]),
  );
}

function showValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number")
    return value.toLocaleString(undefined, { maximumFractionDigits: 20 });
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  return JSON.stringify(value, null, 2);
}

export function changedSettings(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): SettingChange[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((name) => {
    const oldValue = orderedValue(before[name] ?? null);
    const newValue = orderedValue(after[name] ?? null);
    return JSON.stringify(oldValue) === JSON.stringify(newValue)
      ? []
      : [{ name, before: showValue(oldValue), after: showValue(newValue) }];
  });
}

function graphTitle(graph: Graph | undefined) {
  if (graph && "id" in graph && "version" in graph) {
    return `${graph.name} · ${graph.id} v${graph.version}`;
  }
  return graph?.name;
}

function stepSettings(node: WorkflowNode | undefined, graph: Graph | undefined) {
  if (!node || !graph) return {};
  const config = node.config;
  const instructions = node.kind === "review" ? "Review question" : "Instructions";
  const inputs = Object.fromEntries(
    Object.entries(node.inputs ?? {}).map(([port, binding]) => [
      `Input · ${port}`,
      binding.source === "output"
        ? `${binding.node_id} · ${binding.port}`
        : binding.source.replaceAll("_", " "),
    ]),
  );
  const next = Object.fromEntries(
    graph.edges
      .filter((edge) => edge.source === node.id)
      .map((edge) => [`Next · ${edge.source_port ?? "next"}`, edge.target]),
  );
  const common = {
    "Step name": node.label,
    "Step type": node.kind,
    [instructions]: node.instructions ?? "",
    ...inputs,
    ...next,
  };
  if (config?.type === "research") {
    return {
      ...common,
      "Prompt mode": config.stage ?? "hypothesize",
      "Prompt version": config.prompt_version ?? "research-1",
      "Model override": config.model ?? "Workflow default",
      "Web and market search": config.web_search ?? false,
      "SEC financials": config.sec_financials ?? false,
      "Codex analyst": Boolean(config.analyst),
      "Research passes": config.analyst ? (config.analyst.max_passes ?? 4) : undefined,
      "Python workspace": config.analyst?.workspace ?? false,
      "Analyst instructions": config.analyst?.skill ?? "",
    };
  }
  if (config?.type === "code") {
    return {
      ...common,
      Code: config.source,
      "Code runtime": config.runtime,
      "Code timeout (seconds)": config.timeout_seconds,
    };
  }
  return { ...common, "Control settings": config };
}

export function compareWorkflowGraphs(before: Workflow, after: Workflow): GraphChange[] {
  type Pair = { key: string; label: string; before?: Graph; after?: Graph };
  const pending: Pair[] = [{ key: "root", label: "Main workflow", before, after }];
  const seen = new Set<string>();
  const result: GraphChange[] = [];
  for (const pair of pending) {
    const earlier = new Map(pair.before?.nodes.map((node) => [node.id, node]));
    const later = new Map(pair.after?.nodes.map((node) => [node.id, node]));
    const steps: StepChange[] = [];
    for (const id of new Set([...earlier.keys(), ...later.keys()])) {
      const oldStep = earlier.get(id);
      const newStep = later.get(id);
      const label = newStep?.label ?? oldStep?.label ?? id;
      const fields = changedSettings(
        stepSettings(oldStep, pair.before),
        stepSettings(newStep, pair.after),
      );
      if (fields.length) {
        steps.push({
          id,
          label,
          status: !oldStep ? "Added" : !newStep ? "Removed" : "Changed",
          settings: fields,
        });
      }

      const oldRef = oldStep && referenceOf(oldStep);
      const newRef = newStep && referenceOf(newStep);
      if (!oldRef && !newRef) continue;
      const key = `${oldRef ? scopeKey(oldRef) : ""}/${newRef ? scopeKey(newRef) : ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pending.push({
        key,
        label: `${label} · ${pair.label}`,
        before: oldRef && graphAt(before, oldRef),
        after: newRef && graphAt(after, newRef),
      });
    }
    const settings = changedSettings(
      { Definition: graphTitle(pair.before), "First step": pair.before?.start_node },
      { Definition: graphTitle(pair.after), "First step": pair.after?.start_node },
    );
    if (steps.length || settings.length)
      result.push({ key: pair.key, label: pair.label, settings, steps });
  }
  return result;
}
