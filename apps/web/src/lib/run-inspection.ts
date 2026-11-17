import type { Graph, RunSnapshot, WorkflowNode } from "./workflow";
import { referenceOf } from "./workflow-editing";

type RunEvent = RunSnapshot["events"][number];
type Review = NonNullable<RunSnapshot["reviews"]>[number];
type Attempt = NonNullable<RunSnapshot["model_attempts"]>[number];

export type StepStatus =
  | "Waiting for review"
  | "Preparing"
  | "Requesting"
  | "Scheduled"
  | "Completed"
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
  return event.kind === "loop" && path.includes(`/${event.node_id}/check-`)
    ? path.slice(0, path.lastIndexOf("/"))
    : path;
}

export function reviewPath(review: Review) {
  return review.path || `root/${review.node_id}`;
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
  const lastAttempt = run.model_attempts?.at(-1);
  if (lastAttempt && lastAttempt.status !== "completed") return lastAttempt.path;
  if (run.status === "running" && checkpoint[0]) return checkpoint[0].path;
  const event = run.events.findLast((item) =>
    run.status === "rejected"
      ? item.kind === "review"
      : ["code", "note", "research"].includes(item.kind),
  );
  if (event) return eventPath(event);
  return lastAttempt?.path ?? `root/${run.workflow.start_node}`;
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

export function stepStates(run: RunSnapshot) {
  const states = new Map<string, StepStatus>();
  for (const event of run.events) {
    states.set(
      eventPath(event),
      event.kind === "loop" || event.kind === "subgraph"
        ? "Entered"
        : event.kind === "review" && event.detail.startsWith("Rejected")
          ? "Rejected"
          : "Completed",
    );
  }
  for (const attempt of run.model_attempts ?? []) {
    states.set(attempt.path, attemptLabels[attempt.status]);
  }
  for (const step of run.checkpoint_steps ?? []) {
    if (step.status === "stopped") states.set(step.path, "Stopped");
    else if (run.status === "running" && !states.has(step.path)) states.set(step.path, "Scheduled");
  }
  for (const review of pendingReviews(run)) states.set(reviewPath(review), "Waiting for review");
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
