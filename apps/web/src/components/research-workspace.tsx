import { useEffect, useState } from "react";
import type { components } from "@researchchain/contracts";
import { apiFetch } from "@/lib/access";
import { contentDownloadUrl, contentUrl } from "@/lib/evidence";
import { ResearchMarkdown } from "./research-markdown";

type Attempt = components["schemas"]["ModelAttempt"];
type WorkspaceFile = components["schemas"]["WorkspaceFile"];
const imageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const previewLimit = 128 * 1024;

export function canPreviewWorkspaceFile(file: WorkspaceFile) {
  return (
    imageTypes.has(file.media_type) ||
    (file.byte_size <= previewLimit &&
      (file.media_type.startsWith("text/") ||
        file.media_type === "application/json" ||
        /\.(py|md|csv|txt|json)$/i.test(file.name)))
  );
}

function TextPreview({ file, sources }: { file: WorkspaceFile; sources: Set<string> }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await apiFetch(contentUrl(file.artifact_id), {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const body = await response.text();
        if (!controller.signal.aborted) setText(body);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    }
    void load();
    return () => controller.abort();
  }, [file.artifact_id]);
  if (error) return <p role="alert">The saved file could not be loaded.</p>;
  if (text === null) return <p role="status">Loading preview…</p>;
  return file.name.toLowerCase().endsWith(".md") ? (
    <ResearchMarkdown text={text} sources={sources} />
  ) : (
    <pre tabIndex={0}>{text}</pre>
  );
}

export function WorkspaceFilePreview({
  file,
  sources,
}: {
  file: WorkspaceFile;
  sources: Set<string>;
}) {
  return (
    <div className="workspace-file-preview">
      {imageTypes.has(file.media_type) ? (
        // The authenticated artifact URL serves the original chart at its own aspect ratio.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`${contentUrl(file.artifact_id)}?preview=true`}
          alt={`Generated chart, ${file.name}`}
          loading="lazy"
        />
      ) : canPreviewWorkspaceFile(file) ? (
        <TextPreview key={file.artifact_id} file={file} sources={sources} />
      ) : (
        <p className="muted">Download this file to inspect it in full.</p>
      )}
    </div>
  );
}

function WorkspaceFiles({ files, sources }: { files: WorkspaceFile[]; sources: Set<string> }) {
  const [selected, setSelected] = useState<string | null>(null);
  const file =
    files.find((item) => item.name === selected) ??
    files.find((item) => imageTypes.has(item.media_type)) ??
    files[0];
  if (!file) return null;
  return (
    <section className="workspace-files" aria-label="Workspace files">
      <div className="workspace-files-heading">
        <label>
          Workspace files
          <select
            aria-label="Preview workspace file"
            value={file.name}
            onChange={(event) => setSelected(event.target.value)}
          >
            {files.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <a
          className="button small"
          href={contentDownloadUrl(file.artifact_id, file.name)}
          download={file.name}
          aria-label={`Download ${file.name}`}
        >
          Download
        </a>
      </div>
      <p className="field-hint">
        {file.name} · {file.byte_size.toLocaleString()} bytes
      </p>
      <WorkspaceFilePreview file={file} sources={sources} />
    </section>
  );
}

export function ResearchWorkspace({
  attempts,
  running,
}: {
  attempts: Attempt[];
  running: boolean;
}) {
  const files = new Map<string, WorkspaceFile>();
  const sources = new Set<string>();
  const actions = attempts.flatMap((attempt, i) => {
    const result = attempt.result;
    const activity = result?.workspace_activity;
    for (const file of [...(activity?.files ?? []), ...(result?.workspace_files ?? [])])
      files.set(file.name, file);
    for (const source of result?.web_research?.sources ?? []) sources.add(source.url);
    return activity ? [{ id: attempt.id, pass: i + 1, activity }] : [];
  });
  const latest = attempts.at(-1);
  const pending = latest?.status === "preparing" || latest?.status === "requesting";
  return (
    <div className="workspace-run">
      <section aria-label="Workspace activity">
        <h4>Workspace activity</h4>
        {!!actions.length && (
          <ol className="workspace-actions">
            {actions.map(({ id, pass, activity }) => (
              <li key={id}>
                <div>
                  <span className="workspace-action-pass">Pass {pass} · Python</span>
                  <span className="workspace-action-status" data-status={activity.status}>
                    {activity.status}
                  </span>
                </div>
                <p>{activity.summary}</p>
                {(activity.output || !!activity.files?.length) && (
                  <details>
                    <summary>Execution output</summary>
                    {activity.output && <pre tabIndex={0}>{activity.output}</pre>}
                    {!!activity.files?.length && (
                      <ul aria-label={`Files from pass ${pass}`}>
                        {activity.files.map((file) => (
                          <li key={file.name}>
                            <a
                              href={contentDownloadUrl(file.artifact_id, file.name)}
                              download={file.name}
                            >
                              {file.name}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
        {running && pending && latest.result?.workspace_activity?.status !== "requested" ? (
          <p className="workspace-progress" role="status">
            Pass {attempts.length} ·{" "}
            {latest.status === "preparing" ? "Preparing the model request" : "Waiting for Codex"}
            {latest.web_actions_completed
              ? ` · ${latest.web_actions_completed} web actions completed`
              : ""}
          </p>
        ) : (
          !actions.length && <p className="field-hint">No Python actions recorded.</p>
        )}
      </section>
      <WorkspaceFiles files={[...files.values()]} sources={sources} />
    </div>
  );
}
