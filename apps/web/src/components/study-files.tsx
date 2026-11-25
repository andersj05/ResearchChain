import { useMemo, useState } from "react";
import type { components } from "@researchchain/contracts";
import { contentDownloadUrl } from "@/lib/evidence";
import type { SessionWorkspace } from "@/lib/swarm-workspaces";
import { researchToolUrls } from "./research-tool-receipts";
import { canPreviewWorkspaceFile, WorkspaceFilePreview } from "./research-workspace";
import { SessionWorkspaceLink } from "./session-consultations";
import { useStudyIndex, type StudyIndexFocus } from "./study-index-link";
import styles from "./study-files.module.css";

type Attempt = SessionWorkspace["attempts"][number];
type WorkspaceFile = components["schemas"]["WorkspaceFile"];
type IndexedFile = {
  key: string;
  file: WorkspaceFile;
  lane: SessionWorkspace;
  lead?: string;
  attempt: Attempt;
  pass: number;
  savedAt: number;
  search: string;
};
type FileCursor = Pick<IndexedFile, "key" | "file" | "savedAt">;

const pageSize = 20;

function newestFileFirst(left: FileCursor, right: FileCursor) {
  const order = right.savedAt - left.savedAt || left.file.name.localeCompare(right.file.name);
  if (order || left.key === right.key) return order;
  return left.key < right.key ? -1 : 1;
}

function filesIn(attempt: Attempt) {
  const result = attempt.result;
  return [
    ...(result?.workspace_activity?.files ?? []),
    ...(result?.workspace_files ?? []),
    ...(result?.report_artifact ? [result.report_artifact] : []),
  ];
}

export function hasStudyFiles(lanes: SessionWorkspace[]) {
  return lanes.some(({ attempts }) =>
    attempts.some(({ result }) =>
      Boolean(
        result?.workspace_activity?.files?.length ||
        result?.workspace_files?.length ||
        result?.report_artifact,
      ),
    ),
  );
}

function indexFiles(lanes: SessionWorkspace[]) {
  const byLane = new Map(lanes.map((lane) => [lane.key, lane]));
  const entries = new Map<string, IndexedFile>();
  for (const lane of lanes) {
    const lead = lane.parentKey ? byLane.get(lane.parentKey)?.title : undefined;
    for (const [index, attempt] of lane.attempts.entries()) {
      const savedAt = Date.parse(attempt.created_at);
      for (const file of filesIn(attempt)) {
        const key = JSON.stringify([lane.key, file.name, file.artifact_id]);
        // Later receipts carry workspace contents forward. Keep the first receipt
        // that saved this version and every distinct content hash in the lane.
        if (!entries.has(key)) {
          entries.set(key, {
            key,
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
  }
  return [...entries.values()].sort(newestFileFirst);
}

function FilePreview({ entry, lanes }: { entry: IndexedFile; lanes: SessionWorkspace[] }) {
  const cutoff = entry.savedAt;
  const attempts =
    entry.lane.key === "editor"
      ? lanes.flatMap(({ attempts }) => attempts.filter((a) => Date.parse(a.created_at) <= cutoff))
      : entry.lane.attempts.slice(0, entry.pass);
  const sources = new Set(
    attempts.flatMap(({ result }) => [
      ...(result?.web_research?.sources.map(({ url }) => url) ?? []),
      ...researchToolUrls(result),
    ]),
  );
  const files = [...new Map(filesIn(entry.attempt).map((file) => [file.name, file])).values()];
  return <WorkspaceFilePreview file={entry.file} sources={sources} files={files} />;
}

export function StudyFiles({
  runId,
  lanes,
  onSelect,
  returnRef,
}: {
  runId: string;
  lanes: SessionWorkspace[];
  onSelect: (workspace: string, pass: string | null, targetId: string) => void;
  returnRef: StudyIndexFocus;
}) {
  const [open, setOpen] = useStudyIndex("files", returnRef);
  const [query, setQuery] = useState("");
  const [shownThrough, setShownThrough] = useState<FileCursor>();
  const [preview, setPreview] = useState<string>();
  const entries = useMemo(() => (open ? indexFiles(lanes) : []), [lanes, open]);
  const words = query.toLowerCase().trim().split(/\s+/);
  const matches = entries.filter(({ search }) => words.every((word) => search.includes(word)));
  // A new file can arrive above the rows the owner has already reached.
  const throughIndex = shownThrough
    ? matches.findLastIndex((entry) => newestFileFirst(entry, shownThrough) <= 0)
    : -1;
  const visible = matches.slice(0, Math.max(pageSize, throughIndex + 1));

  function keepThrough(entry: IndexedFile | undefined) {
    if (!entry) return;
    const { key, file, savedAt } = entry;
    setShownThrough({ key, file, savedAt });
  }

  return (
    <details
      id="study-files"
      className={styles.panel}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary id="study-files-heading">Saved files</summary>
      {open && (
        <div className={styles.index}>
          <label>
            Find a saved file
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setShownThrough(undefined);
              }}
              placeholder="Filename, assignment, lead, or path"
              maxLength={240}
            />
          </label>
          <p className={styles.count} role="status">
            {matches.length
              ? `${matches.length} saved ${matches.length === 1 ? "file" : "files"}`
              : "No saved files match."}
          </p>
          {!!matches.length && (
            <ul className={styles.rows} aria-label="Saved file results">
              {visible.map((entry) => {
                const { key, file, lane, lead, attempt, pass } = entry;
                const isPreview = preview === key;
                const passLinkId = `study-file-pass-${encodeURIComponent(key)}`;
                const location = `${lead ? `${lead} · ` : ""}${lane.title} · Pass ${pass}`;
                return (
                  <li key={key} aria-label={`${file.name} · ${location}`}>
                    <div className={styles.row}>
                      <div className={styles.caption}>
                        <strong>{file.name}</strong>
                        <span>{location}</span>
                        <code>{attempt.path}</code>
                        <span>
                          {file.byte_size.toLocaleString()} bytes ·{" "}
                          <code>{file.artifact_id.replace(/^sha256:/, "").slice(0, 12)}</code>
                        </span>
                      </div>
                      <div className={styles.actions}>
                        {canPreviewWorkspaceFile(file) && (
                          <button
                            type="button"
                            className="button small"
                            aria-expanded={isPreview}
                            onClick={() => {
                              if (!isPreview) keepThrough(visible.at(-1));
                              setPreview(isPreview ? undefined : key);
                            }}
                          >
                            {isPreview ? "Close preview" : "Preview"}
                          </button>
                        )}
                        <SessionWorkspaceLink
                          id={passLinkId}
                          runId={runId}
                          lane={lane}
                          pass={attempt.id}
                          onSelect={(workspace, pass) => {
                            keepThrough(visible.at(-1));
                            onSelect(workspace, pass, passLinkId);
                          }}
                        >
                          Open saved pass
                        </SessionWorkspaceLink>
                        <a
                          href={contentDownloadUrl(file.artifact_id, file.name)}
                          download={file.name}
                        >
                          Download
                        </a>
                      </div>
                    </div>
                    {isPreview && (
                      <div className={styles.preview}>
                        <FilePreview entry={entry} lanes={lanes} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {matches.length > visible.length && (
            <button
              className="button small"
              type="button"
              onClick={() =>
                keepThrough(matches[Math.min(visible.length + pageSize, matches.length) - 1])
              }
            >
              Show more files
            </button>
          )}
        </div>
      )}
    </details>
  );
}
