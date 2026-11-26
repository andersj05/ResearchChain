import { useImperativeHandle, useMemo, useRef, useState } from "react";
import { contentDownloadUrl } from "@/lib/evidence";
import type { SessionWorkspace } from "@/lib/swarm-workspaces";
import type { RunSnapshot } from "@/lib/workflow";
import { researchToolUrls } from "./research-tool-receipts";
import { canPreviewWorkspaceFile, WorkspaceFilePreview } from "./research-workspace";
import { SessionWorkspaceLink } from "./session-consultations";
import { StudyFileExplorer } from "./study-file-explorer";
import {
  indexStudyFiles,
  newestStudyFileFirst,
  studyFilesIn,
  type IndexedStudyFile,
  type StudyFileCursor,
} from "./study-file-records";
import { useStudyIndex, type StudyIndexFocus } from "./study-index-link";
import styles from "./study-files.module.css";

const pageSize = 20;
const noArtifacts: RunSnapshot["artifacts"] = [];

export function hasStudyFiles(lanes: SessionWorkspace[], artifacts?: RunSnapshot["artifacts"]) {
  return Boolean(
    artifacts?.length ||
    lanes.some(({ attempts }) =>
      attempts.some(({ result, input_artifact_id, response_artifact_id }) =>
        Boolean(
          input_artifact_id ||
          response_artifact_id ||
          result?.workspace_activity?.files?.length ||
          result?.workspace_files?.length ||
          result?.report_artifact,
        ),
      ),
    ),
  );
}

function FilePreview({ entry, lanes }: { entry: IndexedStudyFile; lanes: SessionWorkspace[] }) {
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
  const files = [...new Map(studyFilesIn(entry.attempt).map((file) => [file.name, file])).values()];
  return <WorkspaceFilePreview file={entry.file} sources={sources} files={files} />;
}

export function StudyFiles({
  runId,
  lanes,
  artifacts = noArtifacts,
  onSelect,
  returnRef,
}: {
  runId: string;
  lanes: SessionWorkspace[];
  artifacts?: RunSnapshot["artifacts"];
  onSelect: (workspace: string, pass: string | null, targetId: string) => void;
  returnRef: StudyIndexFocus;
}) {
  const focusIndex = useRef<((targetId: string) => void) | null>(null);
  const [open, setOpen] = useStudyIndex("files", focusIndex);
  const [view, setView] = useState<"explorer" | "timeline">("explorer");
  const [query, setQuery] = useState("");
  const [shownThrough, setShownThrough] = useState<StudyFileCursor>();
  const [preview, setPreview] = useState<string>();
  const entries = useMemo(() => (open ? indexStudyFiles(lanes) : []), [lanes, open]);
  const words = query.toLowerCase().trim().split(/\s+/);
  const matches =
    view === "timeline"
      ? entries.filter(({ search }) => words.every((word) => search.includes(word)))
      : [];
  // A new file can arrive above the rows the owner has already reached.
  const throughIndex = shownThrough
    ? matches.findLastIndex((entry) => newestStudyFileFirst(entry, shownThrough) <= 0)
    : -1;
  const visible = matches.slice(0, Math.max(pageSize, throughIndex + 1));

  useImperativeHandle(
    returnRef,
    () => (targetId) => {
      const targetView = targetId.startsWith("study-explorer-pass-") ? "explorer" : "timeline";
      if (targetView === view) focusIndex.current?.(targetId);
      else {
        setView(targetView);
        requestAnimationFrame(() => focusIndex.current?.(targetId));
      }
    },
    [view],
  );

  function keepThrough(entry: IndexedStudyFile | undefined) {
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
        <div className={styles.views} role="group" aria-label="Saved file view">
          <button
            type="button"
            aria-pressed={view === "explorer"}
            onClick={() => setView("explorer")}
          >
            Explorer
          </button>
          <button
            type="button"
            aria-pressed={view === "timeline"}
            onClick={() => setView("timeline")}
          >
            Recent versions
          </button>
        </div>
      )}
      <StudyFileExplorer
        visible={open && view === "explorer"}
        lanes={lanes}
        entries={entries}
        artifacts={artifacts}
        runId={runId}
        onSelect={onSelect}
        renderWorkspaceFile={(entry) => <FilePreview entry={entry} lanes={lanes} />}
      />
      {open && view === "timeline" && (
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
