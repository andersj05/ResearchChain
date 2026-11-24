import { useState } from "react";
import { contentDownloadUrl } from "@/lib/evidence";
import { graphLocation } from "@/lib/run-inspection";
import type { RunSnapshot } from "@/lib/workflow";
import { canPreviewWorkspaceFile, WorkspaceFilePreview } from "./research-workspace";
import { latestWorkspaceFiles, workspaceFileContext, type SavedFile } from "./run-files";

function FileVersion({
  entry,
  title,
  run,
}: {
  entry?: SavedFile;
  title: string;
  run: RunSnapshot;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label={title}>
      <h5>{title}</h5>
      {entry ? (
        <>
          <p className="field-hint">
            Pass {entry.pass} · {entry.file.byte_size.toLocaleString()} bytes
          </p>
          <a
            className="button small"
            href={contentDownloadUrl(entry.file.artifact_id, entry.file.name)}
            download={entry.file.name}
            aria-label={`Download ${entry.file.name} from ${title.toLowerCase()}`}
          >
            Download
          </a>
          {canPreviewWorkspaceFile(entry.file) && (
            <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
              <summary>Preview</summary>
              {open && (
                <WorkspaceFilePreview
                  file={entry.file}
                  {...workspaceFileContext(run, entry.path, entry.attemptId)}
                />
              )}
            </details>
          )}
        </>
      ) : (
        <p className="muted">No saved file</p>
      )}
    </section>
  );
}

export function RunOutputFileChanges({
  before,
  after,
}: {
  before: RunSnapshot;
  after: RunSnapshot;
}) {
  const earlier = latestWorkspaceFiles(before);
  const later = latestWorkspaceFiles(after);
  if (!earlier.size && !later.size) return null;
  const changes = [...new Set([...earlier.keys(), ...later.keys()])].flatMap((key) => {
    const old = earlier.get(key);
    const next = later.get(key);
    const entry = next ?? old;
    if (!entry || old?.file.artifact_id === next?.file.artifact_id) return [];
    const run = next ? after : before;
    const { node, parents } = graphLocation(run, entry.path);
    return [{ key, old, next, entry, label: node.label, nested: parents.length > 0 }];
  });
  return (
    <details className="comparison-output-changes">
      <summary>Output file changes{changes.length > 0 && ` (${changes.length})`}</summary>
      {changes.length ? (
        <ul>
          {changes.map(({ key, old, next, entry, label, nested }) => (
            <li key={key}>
              <h4>{entry.file.name}</h4>
              <p className="field-hint">
                {label}
                {nested && ` · ${entry.path.replaceAll("/", " › ")}`}
              </p>
              <div className="comparison-output-versions">
                <FileVersion entry={old} title="Comparison run" run={before} />
                <FileVersion entry={next} title="Open run" run={after} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">The latest saved files match.</p>
      )}
    </details>
  );
}
