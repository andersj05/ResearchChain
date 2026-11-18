import { useId, useState } from "react";
import type { components } from "@researchchain/contracts";
import { contentDownloadUrl } from "@/lib/evidence";
import { attemptPath, graphLocation } from "@/lib/run-inspection";
import type { RunSnapshot } from "@/lib/workflow";
import { canPreviewWorkspaceFile, WorkspaceFilePreview } from "./research-workspace";
import { researchToolUrls } from "./research-tool-receipts";

export type SavedFile = {
  file: components["schemas"]["WorkspaceFile"];
  path: string;
  attemptId: string;
  pass: number;
};

export function* workspaceFileReceipts(run: RunSnapshot): Generator<SavedFile> {
  const passes = new Map<string, number>();
  for (const attempt of run.model_attempts ?? []) {
    const path = attemptPath(attempt);
    const pass = (passes.get(path) ?? 0) + 1;
    passes.set(path, pass);
    const result = attempt.result;
    const saved = [
      ...(result?.workspace_activity?.files ?? []),
      ...(result?.workspace_files ?? []),
    ];
    for (const file of saved) yield { file, attemptId: attempt.id, path, pass };
  }
}

export function savedRunFiles(run: RunSnapshot) {
  const files = new Map<string, SavedFile>();
  for (const receipt of workspaceFileReceipts(run)) {
    const { path, file } = receipt;
    const key = JSON.stringify([path, file.name, file.artifact_id]);
    // Later passes may repeat the same file in the workspace inventory.
    if (!files.has(key)) files.set(key, receipt);
  }
  return [...files.entries()].reverse();
}

export function workspaceFileSources(run: RunSnapshot, path: string, attemptId: string) {
  const sources = new Set<string>();
  for (const attempt of run.model_attempts ?? []) {
    if (attemptPath(attempt) !== path) continue;
    for (const source of attempt.result?.web_research?.sources ?? []) sources.add(source.url);
    for (const url of researchToolUrls(attempt.result)) sources.add(url);
    if (attempt.id === attemptId) break;
  }
  return sources;
}

export function RunFiles({
  files,
  run,
  inspect,
}: {
  files: ReturnType<typeof savedRunFiles>;
  run: RunSnapshot;
  inspect: (path: string, attemptId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<string>();
  const panelId = useId();
  const search = query.trim().toLowerCase();
  const visible = files.flatMap(([key, item]) => {
    const { node, parents } = graphLocation(run, item.path);
    const words = [item.file.name, item.file.media_type, node.label, item.path];
    return words.some((word) => word.toLowerCase().includes(search))
      ? [{ key, ...item, label: node.label, nested: parents.length > 0 }]
      : [];
  });
  return (
    <section className="run-files" aria-label="Saved workspace files">
      <label>
        Filter run files
        <input
          type="search"
          placeholder="Filename, file type, or step"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {!files.length ? (
        <p className="muted">No workspace files have been saved.</p>
      ) : !visible.length ? (
        <p className="muted" role="status">
          No files match this filter.
        </p>
      ) : (
        <ul>
          {visible.map(({ key, file, path, attemptId, pass, label, nested }) => (
            <li key={key}>
              <div className="run-file-metadata">
                <strong>{file.name}</strong>
                <small>{file.byte_size.toLocaleString()} bytes</small>
                {nested && <small>{path.replaceAll("/", " › ")}</small>}
                <button
                  className="text-link"
                  type="button"
                  onClick={() => inspect(path, attemptId)}
                >
                  {label} · Pass {pass}
                </button>
              </div>
              <div className="actions run-file-actions">
                {canPreviewWorkspaceFile(file) && (
                  <button
                    className="button small"
                    type="button"
                    aria-label={`${preview === key ? "Hide preview of" : "Preview"} ${file.name} from ${label}, pass ${pass}`}
                    aria-expanded={preview === key}
                    aria-controls={preview === key ? panelId : undefined}
                    onClick={() => setPreview(preview === key ? undefined : key)}
                  >
                    {preview === key ? "Hide preview" : "Preview"}
                  </button>
                )}
                <a
                  className="button small"
                  href={contentDownloadUrl(file.artifact_id, file.name)}
                  download={file.name}
                  aria-label={`Download ${file.name} from ${label}, pass ${pass}`}
                >
                  Download
                </a>
              </div>
              {preview === key && (
                <div
                  className="run-file-preview"
                  id={panelId}
                  role="region"
                  aria-label={`Preview of ${file.name} from pass ${pass}`}
                >
                  <WorkspaceFilePreview
                    file={file}
                    sources={workspaceFileSources(run, path, attemptId)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
