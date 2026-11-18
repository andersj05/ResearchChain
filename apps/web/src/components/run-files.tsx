import { useState } from "react";
import type { components } from "@researchchain/contracts";
import { contentDownloadUrl } from "@/lib/evidence";
import { attemptPath, graphLocation } from "@/lib/run-inspection";
import type { RunSnapshot } from "@/lib/workflow";

type SavedFile = {
  file: components["schemas"]["WorkspaceFile"];
  path: string;
  attemptId: string;
  pass: number;
};

export function savedRunFiles(run: RunSnapshot) {
  const files = new Map<string, SavedFile>();
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
    for (const file of saved) {
      const key = JSON.stringify([path, file.name, file.artifact_id]);
      // Later passes may repeat the same file in the workspace inventory.
      if (!files.has(key)) files.set(key, { file, attemptId: attempt.id, path, pass });
    }
  }
  return [...files.entries()].reverse();
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
              <div>
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
              <a
                className="button small"
                href={contentDownloadUrl(file.artifact_id, file.name)}
                download={file.name}
                aria-label={`Download ${file.name} from ${label}, pass ${pass}`}
              >
                Download
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
