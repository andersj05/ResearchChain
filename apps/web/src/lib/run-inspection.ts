import type { Graph, RunSnapshot, WorkflowNode } from "./workflow";
import { referenceOf } from "./workflow-editing";

type RunEvent = RunSnapshot["events"][number];
type Review = NonNullable<RunSnapshot["reviews"]>[number];
type Attempt = NonNullable<RunSnapshot["model_attempts"]>[number];
export type ComparisonPasses = { baselineAttempt?: string; openAttempt?: string };
export type PassComparisonLabels = { comparison: string; current: string };
export const defaultPassComparisonLabels = {
  comparison: "Comparison pass",
  current: "Open run pass",
};
export type ReviewBookmark = { checkpointId: string; interruptId: string };

export function runInspectionUrl(
  location: string,
  run: string,
  key: "compare" | "attempt" | "review" | "iterations",
  id: string,
) {
  const url = new URL(location);
  url.search = new URLSearchParams({ view: "runs", run, [key]: id }).toString();
  url.hash = "";
  return url;
}

export type StepStatus =
  | "Waiting for review"
  | "Preparing"
  | "Requesting"
  | "Python requested"
  | "Scheduled"
  | "Completed"
  | "Output saved"
  | "Entered"
  | "Stopped"
  | "Failed"
  | "Outcome unknown"
  | "Cancelled"
  | "Limit reached"
  | "Rejected"
  | "Not reached";

export function eventPath(event: RunEvent) {
  const path = event.path || `root/${event.node_id}`;
  // A loop check is recorded against its own iteration, on the parent loop step.
  return event.kind === "loop" && path.split("/").length % 2 === 1 && /\/check-\d+$/.test(path)
    ? path.slice(0, path.lastIndexOf("/"))
    : path;
}

export function reviewPath(review: Review) {
  return review.path || `root/${review.node_id}`;
}

export function attemptPath(attempt: Attempt) {
  const segments = attempt.path.split("/");
  // Step IDs can themselves be named analyst-pass-2. Only strip the receipt
  // suffix one segment beyond the normal node path (root/id[/body/id…]).
  const teamMember = /^agent-[1-4]$/.test(segments.at(-2) ?? "");
  return (segments.length % 2 === 1 || teamMember) && /^analyst-pass-\d+$/.test(segments.at(-1)!)
    ? segments.slice(0, -1).join("/")
    : attempt.path;
}

export type SavedModelPass = {
  attempt: Attempt;
  number: number;
  kind: "Conclusion" | "Research lead" | "Workspace activity";
};

export function savedModelOutputs(run: RunSnapshot) {
  const outputs = new Map<string, SavedModelPass[]>();
  const counts = new Map<string, number>();
  for (const attempt of run.model_attempts ?? []) {
    const path = attemptPath(attempt);
    const number = (counts.get(path) ?? 0) + 1;
    counts.set(path, number);
    const result = attempt.result;
    if (attempt.status !== "completed" || !result) continue;
    const passes = outputs.get(path) ?? [];
    const kind = result.workspace_activity
      ? "Workspace activity"
      : result.next_lead
        ? "Research lead"
        : "Conclusion";
    passes.push({ attempt, number, kind });
    outputs.set(path, passes);
  }
  return outputs;
}

export function selectedModelOutput(passes: SavedModelPass[], id?: string) {
  return (
    passes.find((item) => item.attempt.id === id) ??
    passes.findLast((item) => item.kind === "Conclusion") ??
    passes.at(-1)
  );
}

export function iterationDifference(left: string, right: string) {
  const a = left.split("/");
  const b = right.split("/");
  if (a.length !== b.length) return 0;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] === b[index]) continue;
    if (difference || index < 2 || index % 2 !== 0) return 0;
    const before = /^iteration-([1-9]\d*)$/.exec(a[index]!);
    const after = /^iteration-([1-9]\d*)$/.exec(b[index]!);
    if (!before || !after) return 0;
    difference = Number(after[1]) - Number(before[1]);
  }
  return difference;
}

export function iterationPeers(paths: Iterable<string>, path: string) {
  return [...paths]
    .flatMap((candidate) => {
      const difference = iterationDifference(path, candidate);
      return difference ? [{ path: candidate, difference }] : [];
    })
    .sort((left, right) => left.difference - right.difference);
}

export type IterationOutput = { path: string; attemptId: string };
export type IterationComparison = { comparison: IterationOutput; current: IterationOutput };

export function linkedIterationComparison(run: RunSnapshot, value: string) {
  const [before, after, extra] = value.toLowerCase().split(",");
  if (!before || !after || extra !== undefined) return;
  const paths = new Map<string, string>();
  for (const [path, passes] of savedModelOutputs(run)) {
    for (const { attempt } of passes) paths.set(attempt.id, path);
  }
  const earlier = paths.get(before);
  const later = paths.get(after);
  if (!earlier || !later || iterationDifference(earlier, later) <= 0) return;
  return {
    comparison: { path: earlier, attemptId: before },
    current: { path: later, attemptId: after },
  };
}

export function pendingReviews(run: RunSnapshot) {
  return run.status === "paused"
    ? run.reviews?.length
      ? run.reviews
      : run.review
        ? [run.review]
        : []
    : [];
}

export function bookmarkedReview(run: RunSnapshot, { checkpointId, interruptId }: ReviewBookmark) {
  return checkpointId === run.checkpoint_id
    ? pendingReviews(run).find((review) => review.interrupt_id === interruptId)
    : undefined;
}

export function preferredPath(run: RunSnapshot) {
  const review = pendingReviews(run)[0];
  if (review) return reviewPath(review);
  const checkpoint = run.checkpoint_steps ?? [];
  const stopped = checkpoint.find((step) => step.status === "stopped");
  if (stopped) return stopped.path;
  const active =
    run.status === "running" &&
    run.model_attempts?.findLast(
      (attempt) => attempt.status === "requesting" || attempt.status === "preparing",
    );
  if (active) return attemptPath(active);
  const lastAttempt = run.model_attempts?.at(-1);
  if (lastAttempt && lastAttempt.status !== "completed") return attemptPath(lastAttempt);
  if (checkpoint[0]) return checkpoint[0].path;
  const event = run.events.findLast((item) =>
    run.status === "rejected"
      ? item.kind === "review"
      : ["code", "note", "research"].includes(item.kind),
  );
  if (event) return eventPath(event);
  return lastAttempt ? attemptPath(lastAttempt) : `root/${run.workflow.start_node}`;
}

const attemptLabels: Record<Attempt["status"], StepStatus> = {
  preparing: "Preparing",
  requesting: "Requesting",
  completed: "Completed",
  failed: "Failed",
  unknown: "Outcome unknown",
  cancelled: "Cancelled",
  limited: "Limit reached",
};

export function modelAttemptStatus(attempt: Attempt): StepStatus {
  if (
    attempt.status === "requesting" &&
    attempt.result?.workspace_activity?.status === "requested"
  ) {
    return "Python requested";
  }
  return attemptLabels[attempt.status];
}

export function stepStates(run: RunSnapshot) {
  const states = new Map<string, StepStatus>();
  for (const event of run.events) {
    states.set(
      eventPath(event),
      event.kind === "loop" || event.kind === "subgraph"
        ? run.status === "completed"
          ? "Completed"
          : "Entered"
        : event.kind === "review" &&
            (event.review_response?.decision === "reject" || event.detail.startsWith("Rejected"))
          ? "Rejected"
          : "Completed",
    );
  }
  const recorded = new Set(states.keys());
  for (const attempt of run.model_attempts ?? []) {
    const path = attemptPath(attempt);
    // An analyst may have another pass after it saves a valid result. The
    // graph step only completes once the executor records its final output.
    let status = modelAttemptStatus(attempt);
    if (attempt.status === "completed" && !recorded.has(path)) status = "Output saved";
    states.set(path, status);
  }
  for (const step of run.checkpoint_steps ?? []) {
    if (step.status === "stopped") states.set(step.path, "Stopped");
    else if (!states.has(step.path)) states.set(step.path, "Scheduled");
  }
  for (const review of pendingReviews(run)) states.set(reviewPath(review), "Waiting for review");
  // Show a child checkpoint on its enclosing card when browsing the outer graph.
  const attention = new Set<StepStatus>([
    "Preparing",
    "Requesting",
    "Python requested",
    "Stopped",
    "Waiting for review",
  ]);
  for (const [path, status] of states) {
    if (!attention.has(status)) continue;
    const segments = path.split("/");
    for (let len = 2; len < segments.length; len += 2) {
      const parent = segments.slice(0, len).join("/");
      if (states.get(parent) !== "Stopped") states.set(parent, status);
    }
  }
  return states;
}

export function graphLocation(run: RunSnapshot, path: string) {
  const parts = path.split("/");
  let graph: Graph = run.workflow;
  let prefix = "root";
  const parents: { path: string; label: string }[] = [];
  for (let i = 1; i < parts.length - 1; i += 2) {
    const node = graph.nodes.find((item) => item.id === parts[i]);
    if (!node) break;
    if (node.config?.type === "research" && node.config.team) {
      return { graph, prefix, parents, node };
    }
    const ref = referenceOf(node);
    const body = run.workflow.subgraphs?.find(
      (item) => item.id === ref?.id && item.version === ref.version,
    );
    if (!body) break;
    const nodePath = `${prefix}/${node.id}`;
    parents.push({ path: nodePath, label: node.label });
    graph = body;
    prefix = `${nodePath}/${parts[i + 1]}`;
  }
  const node = graph.nodes.find((item) => `${prefix}/${item.id}` === path) ?? graph.nodes[0]!;
  return { graph, prefix, parents, node };
}

export type DirectLoopIteration = { caller: string; number: number; limit: number };

export function directLoopIteration(
  run: RunSnapshot,
  path: string,
): DirectLoopIteration | undefined {
  const { prefix, node, parents } = graphLocation(run, path);
  if (path !== `${prefix}/${node.id}`) return;
  let iteration: DirectLoopIteration | undefined;
  for (const parent of parents) {
    const caller = graphLocation(run, parent.path);
    if (parent.path !== `${caller.prefix}/${caller.node.id}`) return;
    const selector = path.slice(parent.path.length + 1).split("/", 1)[0]!;
    const config = caller.node.config;
    if (config?.type === "subgraph" && selector === "body") {
      iteration = undefined;
    } else if (config?.type === "loop") {
      const number = Number(/^iteration-([1-9]\d*)$/.exec(selector)?.[1]);
      if (!Number.isInteger(number) || number > config.max_iterations) return;
      iteration = { caller: parent.path, number, limit: config.max_iterations };
    } else {
      return;
    }
  }
  return iteration;
}

export function nextLoopIteration(iteration?: DirectLoopIteration) {
  if (!iteration || iteration.number >= iteration.limit) return;
  const number = iteration.number + 1;
  return { number, prefix: `${iteration.caller}/iteration-${number}` };
}

export function previousIterationOutput(
  run: RunSnapshot,
  iteration: DirectLoopIteration,
  node: WorkflowNode,
) {
  const number = iteration.number - 1;
  const path = `${iteration.caller}/iteration-${number}/${node.id}`;
  const checkPath = `${iteration.caller}/check-${number}`;
  const callerId = iteration.caller.split("/").at(-1);
  if (
    number < 1 ||
    !run.events.some(
      (event) => event.kind === "loop" && event.node_id === callerId && event.path === checkPath,
    )
  )
    return;
  const event = run.events.find(
    (event) => event.kind === node.kind && event.node_id === node.id && eventPath(event) === path,
  );
  if (!event || (node.kind === "code" && !event.code)) return;
  if (node.kind === "review" && event.review_response?.decision !== "approve") return;
  if (node.kind !== "research") return { path };
  const attempt = run.model_attempts?.findLast(
    (item) =>
      item.status === "completed" &&
      item.result &&
      !item.result.next_lead &&
      !item.result.workspace_activity &&
      attemptPath(item) === path,
  );
  return attempt ? { path, attemptId: attempt.id } : undefined;
}

export function runStepLabel(run: RunSnapshot, path: string) {
  const { node, parents } = graphLocation(run, path);
  const context = parents.map((parent) => {
    const iteration = /^iteration-(\d+)\//.exec(path.slice(parent.path.length + 1))?.[1];
    return iteration ? `Iteration ${iteration} · ${parent.label}` : parent.label;
  });
  return [node.label, ...context].join(" · ");
}

export function feedbackRecipients(
  graph: Graph,
  reviewId: string,
  timing: "output" | "previous_iteration" = "output",
) {
  return graph.nodes.filter((node) =>
    Object.values(node.inputs ?? {}).some(
      (input) => input.source === timing && input.node_id === reviewId && input.port === "feedback",
    ),
  );
}

export function childGraphs(
  run: RunSnapshot,
  node: WorkflowNode,
  path: string,
  states: Map<string, StepStatus>,
) {
  const ref = referenceOf(node);
  const body = run.workflow.subgraphs?.find(
    (item) => item.id === ref?.id && item.version === ref.version,
  );
  if (!body) return [];
  if (node.kind === "subgraph")
    return [{ label: body.name, path: `${path}/body/${body.start_node}` }];
  const iterations = new Set<number>([1]);
  for (const key of states.keys()) {
    if (key.startsWith(path + "/iteration-")) {
      const iteration = Number(key.slice(path.length + "/iteration-".length).split("/")[0]);
      if (Number.isInteger(iteration)) iterations.add(iteration);
    }
  }
  return [...iterations]
    .sort((a, b) => a - b)
    .map((i) => ({
      label: `Iteration ${i}`,
      path: `${path}/iteration-${i}/${body.start_node}`,
    }));
}
