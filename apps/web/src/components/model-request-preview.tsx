import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/access";
import { contentUrl, evidenceUrl, sourceMetadata } from "@/lib/evidence";

const previewBytes = 8_000_000;
const previewCharacters = 20_000;
const evidenceId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : undefined;
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function parseRequest(body: ArrayBuffer) {
  const request = object(JSON.parse(new TextDecoder().decode(body)));
  const message = object(first(request?.input));
  const input = object(first(message?.content));
  if (message?.role !== "user" || input?.type !== "input_text" || typeof input.text !== "string")
    return null;
  const packet = object(JSON.parse(input.text));
  if (
    typeof packet?.brief !== "string" ||
    typeof packet.human_feedback !== "string" ||
    typeof packet.additional_context !== "string" ||
    !Array.isArray(packet.sources)
  )
    return null;
  const sources = packet.sources.flatMap((value: unknown) => {
    const source = object(value);
    const id = text(source?.id);
    if (!source || !evidenceId.test(id)) return [];
    return [
      {
        id,
        title: text(source.title) || `Source ${id.slice(0, 8)}`,
        metadata: sourceMetadata({
          representation: text(source.representation) || undefined,
          as_of_date: text(source.as_of_date),
          published_date: text(source.published_date),
        }),
        delivery: text(source.delivery),
        text: text(source.text),
        record: source,
      },
    ];
  });
  if (sources.length !== packet.sources.length) return null;
  return {
    brief: packet.brief,
    feedback: packet.human_feedback,
    context: packet.additional_context,
    priorResult: object(packet.prior_result),
    instructions: text(request?.instructions),
    sources,
  };
}

export type SavedModelInputs = NonNullable<ReturnType<typeof parseRequest>>;
export type SavedRequestArtifact = { id: string; bytes: number };

export function ModelInputExcerpt({ value }: { value: string }) {
  return (
    <>
      <pre tabIndex={0}>{value.slice(0, previewCharacters)}</pre>
      {value.length > previewCharacters && (
        <p className="field-hint">Preview shortened. Open the saved request for the full text.</p>
      )}
    </>
  );
}

type PreviewResult = SavedModelInputs | null | "failed" | "large";

export function useModelRequestPreview({ id, bytes }: SavedRequestArtifact) {
  const [state, setState] = useState<{ id: string; preview: PreviewResult }>();
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (bytes > previewBytes) return;
    const controller = new AbortController();
    function save(preview: PreviewResult) {
      if (!controller.signal.aborted) setState({ id, preview });
    }
    async function load() {
      try {
        const response = await apiFetch(contentUrl(id), {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]),
        });
        if (!response.ok) throw new Error();
        if (Number(response.headers.get("content-length")) > previewBytes) {
          save("large");
          return;
        }
        const body = await response.arrayBuffer();
        if (!controller.signal.aborted)
          save(body.byteLength > previewBytes ? "large" : parseRequest(body));
      } catch {
        save("failed");
      }
    }
    void load();
    return () => controller.abort();
  }, [bytes, generation, id]);
  return {
    preview: bytes > previewBytes ? "large" : state?.id === id ? state.preview : undefined,
    retry: () => {
      setState(undefined);
      setGeneration((value) => value + 1);
    },
  } as const;
}

function Preview({ id, bytes }: SavedRequestArtifact) {
  const { preview, retry } = useModelRequestPreview({ id, bytes });
  if (preview === undefined) return <p role="status">Loading saved inputs…</p>;
  if (preview === "failed")
    return (
      <div>
        <p role="alert">The saved request could not be previewed.</p>
        <button type="button" className="button small" onClick={retry}>
          Retry saved input preview
        </button>
      </div>
    );
  if (preview === "large" || preview === null)
    return <p className="field-hint">Open the saved request to inspect these inputs.</p>;

  const priorConclusion = text(preview.priorResult?.conclusion);
  return (
    <section className="saved-model-inputs" aria-label="Saved model inputs">
      <h4>Research brief</h4>
      <ModelInputExcerpt value={preview.brief} />
      {preview.feedback && (
        <>
          <h4>Reviewer feedback</h4>
          <ModelInputExcerpt value={preview.feedback} />
        </>
      )}
      {preview.context && (
        <details>
          <summary>Additional context</summary>
          <ModelInputExcerpt value={preview.context} />
        </details>
      )}
      {priorConclusion && (
        <details>
          <summary>Prior result conclusion</summary>
          <ModelInputExcerpt value={priorConclusion} />
        </details>
      )}
      {preview.sources.length > 0 && (
        <details>
          <summary>Evidence in the request ({preview.sources.length})</summary>
          <ul>
            {preview.sources.map((source) => (
              <li key={source.id}>
                <a href={evidenceUrl(source.id)} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
                <p className="field-hint">
                  {source.metadata}
                  {` · ${source.delivery || "Delivery details unavailable"}`}
                </p>
                {source.text && (
                  <details>
                    <summary>Supplied text</summary>
                    <ModelInputExcerpt value={source.text} />
                  </details>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {preview.instructions && (
        <details>
          <summary>Saved instructions</summary>
          <ModelInputExcerpt value={preview.instructions} />
        </details>
      )}
    </section>
  );
}

export function ModelRequestPreview({ id, bytes }: SavedRequestArtifact) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="research-disclosure"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Inspect saved inputs</summary>
      {open && (
        <>
          <Preview key={id} id={id} bytes={bytes} />
          <a className="text-link" href={contentUrl(id)} download>
            Download saved request
          </a>
        </>
      )}
    </details>
  );
}
