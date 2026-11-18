import type { Graph, RunSnapshot, WorkflowNode } from "./workflow";
import { referenceOf } from "./workflow-editing";

type RunEvent = RunSnapshot["events"][number];
type Review = NonNullable<RunSnapshot["reviews"]>[number];
type Attempt = NonNullable<RunSnapshot["model_attempts"]>[number];

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
  return segments.length % 2 === 1 && /^analyst-pass-\d+$/.test(segments.at(-1)!)
    ? segments.slice(0, -1).join("/")
    : attempt.path;
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

export function feedbackRecipients(graph: Graph, reviewId: string) {
  return graph.nodes.filter((node) =>
    Object.values(node.inputs ?? {}).some(
      (input) =>
        input.source === "output" && input.node_id === reviewId && input.port === "feedback",
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
