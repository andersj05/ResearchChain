import type { components } from "@researchchain/contracts";
import type { SessionWorkspace } from "@/lib/swarm-workspaces";

type Attempt = SessionWorkspace["attempts"][number];
type WorkspaceFile = components["schemas"]["WorkspaceFile"];

export type IndexedStudyFile = {
  key: string;
  file: WorkspaceFile;
  lane: SessionWorkspace;
  lead?: string;
  attempt: Attempt;
  pass: number;
  savedAt: number;
  search: string;
};

export type StudyFileCursor = Pick<IndexedStudyFile, "key" | "file" | "savedAt">;

export function newestStudyFileFirst(left: StudyFileCursor, right: StudyFileCursor) {
  const order = right.savedAt - left.savedAt || left.file.name.localeCompare(right.file.name);
  if (order || left.key === right.key) return order;
  return left.key < right.key ? -1 : 1;
}

export function studyFilesIn(attempt: Attempt) {
  const result = attempt.result;
  return [
    ...(result?.workspace_activity?.files ?? []),
    ...(result?.workspace_files ?? []),
    ...(result?.report_artifact ? [result.report_artifact] : []),
  ];
}

export function indexStudyFiles(lanes: SessionWorkspace[]) {
  const byLane = new Map(lanes.map((lane) => [lane.key, lane]));
  const entries: IndexedStudyFile[] = [];
  for (const lane of lanes) {
    const lead = lane.parentKey ? byLane.get(lane.parentKey)?.title : undefined;
    const latest = new Map<string, string>();
    for (const [index, attempt] of lane.attempts.entries()) {
      const savedAt = Date.parse(attempt.created_at);
      const files = new Map(studyFilesIn(attempt).map((file) => [file.name, file]));
      for (const file of files.values()) {
        // Receipts carry unchanged files forward. A later write that restores an
        // earlier hash is a new version and retains its own producing receipt.
        if (latest.get(file.name) === file.artifact_id) continue;
        latest.set(file.name, file.artifact_id);
        entries.push({
          key: JSON.stringify([lane.key, file.name, file.artifact_id, attempt.id]),
          file,
          lane,
          lead,
          attempt,
          pass: index + 1,
          savedAt,
          search: `${file.name} ${lane.title} ${lead ?? ""} ${attempt.path}`.toLowerCase(),
        });
      }
    }
  }
  return entries.sort(newestStudyFileFirst);
}
