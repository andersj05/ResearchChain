import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { FileIcon, FolderIcon } from "lucide-react";
import type { components } from "@researchchain/contracts";
import { apiFetch } from "@/lib/access";
import { contentDownloadUrl, contentUrl, type ArtifactInfo } from "@/lib/evidence";
import type { SessionWorkspace } from "@/lib/swarm-workspaces";
import type { RunSnapshot } from "@/lib/workflow";
import { WorkspaceFilePreview } from "./research-workspace";
import { SessionWorkspaceLink } from "./session-consultations";
import { formatTime } from "./run-status";
import type { IndexedStudyFile } from "./study-file-records";
import styles from "./study-file-explorer.module.css";

type WorkspaceFile = components["schemas"]["WorkspaceFile"];
type FileMetadata = Omit<WorkspaceFile, "byte_size"> & { byte_size?: number };
type Receipt = { lane: SessionWorkspace; pass: number };
type Version = {
  key: string;
  file: FileMetadata;
  workspace?: IndexedStudyFile;
  receipt?: Receipt;
};
type FileGroup = { key: string; name: string; location: string; versions: Version[] };
type Folder = { key: string; title: string; files: FileGroup[]; children: Folder[]; count: number };
type Selection = { group: string; version: string };

const noSources = new Set<string>();
const pageSize = 30;

function folder(key: string, title: string, files: FileGroup[], children: Folder[] = []): Folder {
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return {
    key,
    title,
    files,
    children,
    count: files.length + children.reduce((n, f) => n + f.count, 0),
  };
}

function explorerFiles(
  entries: IndexedStudyFile[],
  artifacts: RunSnapshot["artifacts"],
  lanes: SessionWorkspace[],
) {
  const workspace = new Map<string, Map<string, FileGroup>>();
  const teams = new Map<string, Folder[]>();
  for (const entry of entries) {
    const { key: versionKey, file, lane, lead } = entry;
    const files = workspace.get(lane.key) ?? new Map<string, FileGroup>();
    workspace.set(lane.key, files);
    const group = files.get(file.name) ?? {
      key: JSON.stringify([lane.key, file.name]),
      name: file.name,
      location: [lead, lane.title].filter(Boolean).join(" / "),
      versions: [],
    };
    group.versions.push({ key: versionKey, file, workspace: entry });
    files.set(file.name, group);
  }

  function laneFolder(lane: SessionWorkspace, lead?: string, children: Folder[] = []) {
    const location = [lead, lane.title].filter(Boolean).join(" / ");
    const outputs = [...(workspace.get(lane.key)?.values() ?? [])];
    for (const output of outputs) {
      output.versions.sort((a, b) => b.workspace!.pass - a.workspace!.pass);
    }
    const receipts = lane.attempts.flatMap((attempt, index) =>
      (
        [
          ["request", attempt.input_artifact_id, "json", attempt.input_bytes || undefined],
          ["response", attempt.response_artifact_id, "txt", undefined],
        ] as const
      ).flatMap(([kind, artifact_id, ext, byte_size]) => {
        if (!artifact_id) return [];
        const key = `${attempt.id}-${kind}`;
        const name = `${kind}-${index + 1}.${ext}`;
        const file = { name, artifact_id, media_type: "text/plain", byte_size };
        return [
          {
            key,
            name,
            location: `${location} / Model receipts`,
            versions: [{ key, file, receipt: { lane, pass: index + 1 } }],
          },
        ];
      }),
    );
    return folder(lane.key, lane.title, outputs, [
      ...children,
      ...(receipts.length ? [folder(`${lane.key}/receipts`, "Model receipts", receipts)] : []),
    ]);
  }

  const byLane = new Map(lanes.map((lane) => [lane.key, lane]));
  for (const lane of lanes) {
    if (!lane.parentKey) continue;
    const children = teams.get(lane.parentKey) ?? [];
    const branch = laneFolder(lane, byLane.get(lane.parentKey)?.title);
    if (branch.count) children.push(branch);
    teams.set(lane.parentKey, children);
  }

  const inputs = artifacts.map(({ id, name, media_type }) => {
    const key = `input-${id}`;
    return {
      key,
      name,
      location: "Study inputs",
      versions: [{ key, file: { name, artifact_id: id, media_type } }],
    };
  });
  const folders = [
    folder("inputs", "Study inputs", inputs),
    ...lanes
      .filter((lane) => !lane.parentKey)
      .map((lane) => laneFolder(lane, undefined, teams.get(lane.key))),
  ].filter(({ count }) => count > 0);

  function collect(branch: Folder): FileGroup[] {
    return [...branch.files, ...branch.children.flatMap(collect)];
  }
  return { folders, files: new Map(folders.flatMap(collect).map((group) => [group.key, group])) };
}

function StoredArtifactPreview({ file }: { file: FileMetadata }) {
  const [info, setInfo] = useState<ArtifactInfo | null>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (file.byte_size !== undefined) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await apiFetch(`/api/artifacts/${encodeURIComponent(file.artifact_id)}`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (!response.ok) throw new Error();
        const metadata = (await response.json()) as ArtifactInfo;
        if (metadata.id !== file.artifact_id) throw new Error();
        if (!controller.signal.aborted) setInfo(metadata);
      } catch {
        if (!controller.signal.aborted) setInfo(null);
      }
    }
    void load();
    return () => controller.abort();
  }, [file.artifact_id, file.byte_size, retry]);
  if (info === null)
    return (
      <p role="alert" className={styles.placeholder}>
        File details could not be loaded.{" "}
        <button
          type="button"
          className="text-link"
          onClick={() => {
            setInfo(undefined);
            setRetry((n) => n + 1);
          }}
        >
          Retry preview
        </button>
      </p>
    );
  const byte_size = file.byte_size ?? info?.byte_size;
  if (byte_size === undefined)
    return (
      <p role="status" className={styles.placeholder}>
        Loading file details…
      </p>
    );
  return (
    <WorkspaceFilePreview
      file={{ ...file, media_type: info?.media_type ?? file.media_type, byte_size }}
      sources={noSources}
    />
  );
}

function ExplorerFolder({
  branch,
  open,
  onToggle,
  renderFile,
}: {
  branch: Folder;
  open: ReadonlySet<string>;
  onToggle: (key: string, expanded: boolean) => void;
  renderFile: (file: FileGroup) => ReactNode;
}) {
  const expanded = open.has(branch.key);
  return (
    <li>
      <details open={expanded} onToggle={(event) => onToggle(branch.key, event.currentTarget.open)}>
        <summary>
          <span className={styles.folderLabel}>
            <FolderIcon size={15} aria-hidden="true" /> <strong>{branch.title}</strong>
            <span>{branch.count}</span>
          </span>
        </summary>
        {expanded && (
          <ul>
            {branch.files.map((file) => renderFile(file))}
            {branch.children.map((child) => (
              <ExplorerFolder
                key={child.key}
                branch={child}
                open={open}
                onToggle={onToggle}
                renderFile={renderFile}
              />
            ))}
          </ul>
        )}
      </details>
    </li>
  );
}

export function StudyFileExplorer({
  visible,
  entries,
  artifacts,
  lanes,
  runId,
  onSelect,
  renderWorkspaceFile,
}: {
  visible: boolean;
  entries: IndexedStudyFile[];
  artifacts: RunSnapshot["artifacts"];
  lanes: SessionWorkspace[];
  runId: string;
  onSelect: (workspace: string, pass: string, targetId: string) => void;
  renderWorkspaceFile: (entry: IndexedStudyFile) => ReactNode;
}) {
  const [open, setOpen] = useState(() => new Set(["inputs"]));
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(pageSize);
  const [selection, setSelection] = useState<Selection>();
  const tree = useMemo(
    () => (visible ? explorerFiles(entries, artifacts, lanes) : undefined),
    [visible, entries, artifacts, lanes],
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const fileId = useId();
  if (!tree) return null;

  const group = selection && tree.files.get(selection.group);
  const version = group && group.versions.find(({ key }) => key === selection?.version);
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = words.length
    ? [...tree.files.values()].filter((entry) => {
        const haystack = [
          entry.name,
          entry.location,
          ...entry.versions.map((item) => item.workspace?.attempt.path ?? ""),
        ]
          .join(" ")
          .toLowerCase();
        return words.every((word) => haystack.includes(word));
      })
    : [];
  const latest = group?.versions[0];
  const receiptLane = version?.workspace?.lane ?? version?.receipt?.lane;
  const receiptNumber = version?.workspace?.pass ?? version?.receipt?.pass;
  const attempt = receiptNumber ? receiptLane?.attempts[receiptNumber - 1] : undefined;
  const passLinkId = version && `study-explorer-pass-${encodeURIComponent(version.key)}`;

  function rowId(key: string) {
    return `${fileId}-${encodeURIComponent(key)}`;
  }

  function returnToFiles() {
    const target =
      (selection && document.getElementById(rowId(selection.group))) || searchRef.current;
    target?.focus();
    target?.scrollIntoView({ block: "nearest" });
  }

  function updateFolder(key: string, expanded: boolean) {
    setOpen((current) => {
      if (current.has(key) === expanded) return current;
      const next = new Set(current);
      if (expanded) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function renderFile(fileGroup: FileGroup, showLocation = false) {
    return (
      <li key={fileGroup.key}>
        <button
          type="button"
          id={rowId(fileGroup.key)}
          className={styles.fileRow}
          aria-current={selection?.group === fileGroup.key ? "true" : undefined}
          onClick={() => {
            setSelection({ group: fileGroup.key, version: fileGroup.versions[0]!.key });
            if (window.matchMedia("(max-width: 680px)").matches)
              requestAnimationFrame(() => {
                previewHeading.current?.focus({ preventScroll: true });
                previewHeading.current?.scrollIntoView({ block: "start" });
              });
          }}
        >
          <FileIcon size={15} aria-hidden="true" />
          <span>
            {fileGroup.name}
            {showLocation && <small>{fileGroup.location}</small>}
          </span>
          {fileGroup.versions.length > 1 && (
            <span className={styles.versionCount}>{fileGroup.versions.length} versions</span>
          )}
        </button>
      </li>
    );
  }

  return (
    <div className={styles.explorer}>
      <nav className={styles.sidebar} aria-label="Study file tree">
        <label className={styles.search}>
          Search all files
          <input
            type="search"
            ref={searchRef}
            value={query}
            maxLength={240}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(pageSize);
            }}
            placeholder="Filename or workspace"
          />
        </label>
        {words.length > 0 ? (
          <>
            <p role="status" className={styles.matches}>
              {matches.length
                ? `${matches.length} matching ${matches.length === 1 ? "file" : "files"}`
                : "No matching files."}
            </p>
            <ul className={styles.tree} aria-label="Matching files">
              {matches.slice(0, limit).map((item) => renderFile(item, true))}
            </ul>
            {matches.length > limit && (
              <button
                className="button small"
                type="button"
                onClick={() => {
                  const next = matches[limit];
                  setLimit(limit + pageSize);
                  requestAnimationFrame(() => document.getElementById(rowId(next!.key))?.focus());
                }}
              >
                Show more files
              </button>
            )}
          </>
        ) : (
          <ul className={styles.tree} aria-label="Files by workspace">
            {tree.folders.map((branch) => (
              <ExplorerFolder
                key={branch.key}
                branch={branch}
                open={open}
                onToggle={updateFolder}
                renderFile={renderFile}
              />
            ))}
          </ul>
        )}
      </nav>
      <section className={styles.viewer} aria-label="Study file preview">
        {group && version ? (
          <>
            <header className={styles.viewerHeader}>
              <button type="button" className={`text-link ${styles.back}`} onClick={returnToFiles}>
                Back to file tree
              </button>
              <div className={styles.location}>{group.location}</div>
              <h3 ref={previewHeading} tabIndex={-1}>
                {version.file.name}
              </h3>
              <div className={styles.toolbar}>
                {group.versions.length > 1 && (
                  <label>
                    Saved version
                    <select
                      value={version.key}
                      onChange={(event) =>
                        setSelection({ group: group.key, version: event.target.value })
                      }
                    >
                      {group.versions.map(({ key, workspace }, index) => (
                        <option key={key} value={key}>
                          {index === 0 ? "Latest" : `Version ${group.versions.length - index}`}
                          {workspace && ` · Pass ${workspace.pass}`}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <a
                  href={
                    version.workspace || version.receipt
                      ? contentDownloadUrl(version.file.artifact_id, version.file.name)
                      : contentUrl(version.file.artifact_id)
                  }
                  download={version.file.name}
                  className="button small"
                >
                  Download
                </a>
                {receiptLane && attempt && passLinkId && (
                  <SessionWorkspaceLink
                    id={passLinkId}
                    className="button small"
                    runId={runId}
                    lane={receiptLane}
                    pass={attempt.id}
                    onSelect={(key, pass) => {
                      if (pass) onSelect(key, pass, passLinkId);
                    }}
                  >
                    Open saved pass
                  </SessionWorkspaceLink>
                )}
              </div>
              {attempt && (
                <p className={styles.savedAt}>
                  Saved in pass {receiptNumber} ·{" "}
                  {formatTime(attempt.finished_at ?? attempt.created_at)}
                  {latest?.key !== version.key && " · Earlier version"}
                </p>
              )}
            </header>
            {version.workspace ? (
              renderWorkspaceFile(version.workspace)
            ) : (
              <StoredArtifactPreview key={version.key} file={version.file} />
            )}
          </>
        ) : (
          <p className={styles.placeholder}>
            {selection
              ? "This saved version is no longer available."
              : "Select a file to preview it."}
          </p>
        )}
      </section>
    </div>
  );
}
