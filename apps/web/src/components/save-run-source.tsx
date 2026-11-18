import { useId, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog";
import type { components } from "@researchchain/contracts";
import { api } from "@/lib/workflow";
import { evidenceUrl, type EvidenceCreate, type EvidenceRecord } from "@/lib/evidence";

export function SaveRunSource({
  source,
  runId,
  attemptId,
  observedAt,
}: {
  source: components["schemas"]["WebSource"];
  runId: string;
  attemptId: string;
  observedAt: string;
}) {
  const titleId = useId();
  const initialTitle = Array.from(source.title.replaceAll("\0", "").trim() || source.url)
    .slice(0, 240)
    .join("");
  const [title, setTitle] = useState(initialTitle);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef<string | null>(null);
  const saving = useRef(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const savedLink = useRef<HTMLAnchorElement>(null);

  async function save() {
    if (saving.current || !title.trim()) return;
    saving.current = true;
    setBusy(true);
    setError("");
    requestId.current ??= crypto.randomUUID();
    const record: Pick<
      EvidenceCreate,
      "id" | "title" | "kind" | "availability" | "source_url" | "notes"
    > = {
      id: requestId.current,
      title: title.trim(),
      kind: "link",
      availability: "reference_only",
      source_url: source.url,
      notes: `Provider-reported ${source.cited ? "citation" : "consulted reference"} observed ${observedAt}. Run ${runId}, attempt ${attemptId}.`,
    };
    try {
      const result = await api<EvidenceRecord>("evidence", record);
      setSaved(result.id);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save the source link.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value, details) => {
        if (saving.current) details.cancel();
        else setOpen(value);
      }}
    >
      {saved ? (
        <a
          ref={savedLink}
          className="text-link"
          href={evidenceUrl(saved)}
          target="_blank"
          rel="noopener"
        >
          View saved source
        </a>
      ) : (
        <DialogTrigger className="text-link" aria-label={`Save source link for ${initialTitle}`}>
          Save source link
        </DialogTrigger>
      )}
      <DialogBackdrop className="dialog-backdrop" />
      <DialogContent
        className="run-dialog"
        initialFocus={() => titleInput.current}
        finalFocus={saved ? () => savedLink.current : undefined}
      >
        <DialogTitle>Save a source link</DialogTitle>
        <DialogDescription>
          Review the provider-reported reference before adding it to Sources as Link only.
        </DialogDescription>
        <p className="source-link-url">{source.url}</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label htmlFor={titleId}>Source title</label>
          <input
            ref={titleInput}
            id={titleId}
            required
            maxLength={240}
            disabled={busy}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setError("");
              requestId.current = null;
            }}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            <DialogClose className="button" disabled={busy}>
              Cancel
            </DialogClose>
            <Button className="button primary" type="submit" disabled={busy || !title.trim()}>
              {busy ? "Saving source…" : "Save source"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
