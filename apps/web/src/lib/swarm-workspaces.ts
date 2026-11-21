import type { RunSnapshot } from "./workflow";
import type { ModelProfile } from "./model-settings";
import { initialSwarm } from "./research-sessions";
import { pendingReviews } from "./run-inspection";

type Attempt = NonNullable<RunSnapshot["model_attempts"]>[number];
export type SessionWorkspace = {
  key: string;
  role?: "director" | "lead" | "researcher" | "editor";
  parentKey?: string;
  path?: string;
  state?:
    | "Active"
    | "Queued"
    | "Waiting for researchers"
    | "Awaiting judgment"
    | "Consultation requested"
    | "Awaiting findings"
    | "Completed"
    | "Stopped"
    | "Cancelled"
    | "Failed"
    | "Limited"
    | "Interrupted";
  title: string;
  objective: string;
  attempts: Attempt[];
  profile?: ModelProfile;
};
type Profiles = { lead: ModelProfile; researcher: ModelProfile; editor: ModelProfile };
type State = NonNullable<SessionWorkspace["state"]>;

export function sessionSwarm(run: RunSnapshot) {
  const team = run.workflow.nodes?.find((node) => node.id === "team")?.config;
  const swarm = team?.type === "research" && team.team?.swarm;
  return swarm ? { ...initialSwarm, ...swarm } : null;
}

function receiptState(run: RunSnapshot, last: Attempt | undefined, waiting: State): State {
  if (last?.status === "failed") return "Failed";
  if (last?.status === "limited") return "Limited";
  if (last?.status === "cancelled") return "Cancelled";
  if (last?.status === "unknown") return "Interrupted";
  if (last?.status === "completed" && waiting === "Completed") return waiting;
  if (run.status === "interrupted") return "Interrupted";
  if (["completed", "failed", "limited", "cancelled", "rejected"].includes(run.status))
    return "Stopped";
  if (last?.status === "preparing" || last?.status === "requesting") return "Active";
  return waiting;
}

function workerState(run: RunSnapshot, passes: Attempt[]) {
  const last = passes.at(-1);
  return receiptState(
    run,
    last,
    last?.status === "completed" &&
      last.result &&
      !last.result.workspace_activity &&
      !last.result.next_lead
      ? "Completed"
      : "Queued",
  );
}

export function swarmWorkspaces(
  run: RunSnapshot,
  profiles: Profiles | undefined,
): SessionWorkspace[] {
  const attempts = run.model_attempts ?? [];
  const director = attempts.find((attempt) => attempt.path === "root/team/plan");
  const mandates = director?.result?.swarm_plan?.leads ?? [];
  const lanes: SessionWorkspace[] = [
    {
      key: "director",
      role: "director",
      path: "root/team/plan",
      title: "Swarm director",
      objective: "Divide the brief into independent lead mandates.",
      attempts: director ? [director] : [],
      profile: profiles?.lead,
      state: receiptState(run, director, mandates.length ? "Completed" : "Queued"),
    },
  ];
  for (const [index, mandate] of mandates.entries()) {
    const key = `lead-${index + 1}`;
    const path = `root/team/${key}`;
    const turns = attempts
      .filter((a) => a.path.startsWith(path + "/turn-"))
      .sort((a, b) => Number(a.path.split("/turn-")[1]) - Number(b.path.split("/turn-")[1]));
    const assignments = turns.flatMap((turn) => {
      const action = turn.result?.swarm_action;
      return turn.status === "completed" && action?.action === "delegate" ? action.assignments : [];
    });
    const workers: SessionWorkspace[] = assignments.map((assignment, i) => {
      const workerKey = `${key}/agent-${i + 1}`;
      const workerPath = `root/team/${workerKey}`;
      const passes = attempts.filter(
        (a) => a.path === workerPath || a.path.startsWith(workerPath + "/analyst-pass-"),
      );
      return {
        key: workerKey,
        role: "researcher",
        parentKey: key,
        path: workerPath,
        ...assignment,
        attempts: passes,
        profile: profiles?.researcher,
        state: workerState(run, passes),
      };
    });
    const last = turns.at(-1);
    const action = last?.result?.swarm_action;
    let waiting: State = "Queued";
    if (action?.action === "finish") waiting = "Completed";
    if (action?.action === "delegate" && workers.some((worker) => worker.state !== "Completed"))
      waiting = "Waiting for researchers";
    if (action?.action === "ask_expert") {
      if (run.perspective_answers?.some((answer) => answer.action_path === last?.path))
        waiting = "Queued";
      else
        waiting = pendingReviews(run).some((q) => q.perspective?.action_path === last?.path)
          ? "Awaiting judgment"
          : "Consultation requested";
    }
    lanes.push(
      {
        key,
        path,
        role: "lead",
        ...mandate,
        attempts: turns,
        profile: profiles?.lead,
        state: receiptState(run, last, waiting),
      },
      ...workers,
    );
  }
  const editor = attempts.filter(
    (attempt) =>
      attempt.path === "root/report" || attempt.path.startsWith("root/report/analyst-pass-"),
  );
  lanes.push({
    key: "editor",
    path: "root/report",
    role: "editor",
    title: "Report editor",
    objective:
      "Reconcile the leads’ findings, owner perspectives and supporting files in the report.",
    attempts: editor,
    profile: profiles?.editor,
    state: editor.length
      ? workerState(run, editor)
      : receiptState(run, undefined, "Awaiting findings"),
  });
  return lanes;
}
