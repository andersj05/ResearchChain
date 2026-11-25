"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import { Files, Upload, X } from "lucide-react";
import { api } from "@/lib/workflow";
import {
  uploadOriginal,
  type EvidenceCreate,
  type EvidenceInput,
  type EvidenceRecord,
} from "@/lib/evidence";
import styles from "./source-intake.module.css";

const extensions = ".png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.markdown,.csv,.tsv";
const clipboardImageExtensions = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);
type Row = {
  id: string;
  file: File;
  kind: EvidenceCreate["kind"];
  title: string;
  authorOverride?: string;
  dateOverride?: string;
  invalid?: string;
  error?: string;
  command?: EvidenceInput;
};
export type Attribution = Pick<EvidenceCreate, "rights" | "author" | "as_of_date">;

function kindFor(name: string): Row["kind"] {
  if (/\.(png|jpe?g|webp)$/i.test(name)) return "image";
  if (/\.pdf$/i.test(name)) return "report";
  if (/\.(csv|tsv)$/i.test(name)) return "dataset";
  return "text";
}

function canPreviewChart(row: Row) {
  return (
    row.kind === "image" &&
    !row.invalid &&
    (!row.file.type || clipboardImageExtensions.has(row.file.type))
  );
}

function LocalChart({ file, title }: { file: File; title: string }) {
  const [failed, setFailed] = useState(false);
  const attach = useCallback(
    (image: HTMLImageElement | null) => {
      if (!image) return;
      const url = URL.createObjectURL(file);
      image.src = url;
      return () => {
        image.removeAttribute("src");
        URL.revokeObjectURL(url);
      };
    },
    [file],
  );
  if (failed)
    return (
      <p role="alert" className={styles.queuedChartError}>
        This image could not be previewed.
      </p>
    );
  // A local File is displayed directly by the browser and never sent to an image optimizer.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={attach} className={styles.original} alt={title} onError={() => setFailed(true)} />
  );
}

export function SourceFileBatch({
  attribution,
  count,
  disabled,
  onPin,
  onPending,
  onSaving,
}: {
  attribution: Attribution;
  count: number;
  disabled: boolean;
  onPin: (source: EvidenceRecord) => void;
  onPending: (pending: boolean) => void;
  onSaving: (saving: boolean) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState("");
  const [notice, setNotice] = useState("");
  const [previewId, setPreviewId] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const previewOpener = useRef<HTMLButtonElement>(null);
  const saving = useRef(false);
  const depth = useRef(0);
  const pastedCharts = useRef(0);
  const permitted = attribution.rights && attribution.rights !== "unknown";
  const preview = disabled ? undefined : rows.find((row) => row.id === previewId);

  function choose(files: FileList | File[] | null, pasted = false) {
    if (disabled || saving.current || !files?.length) return;
    setNotice("");
    if (count + rows.length + files.length > 100) {
      setNotice(
        `A packet holds 100 sources. Choose up to ${100 - count - rows.length} more files.`,
      );
      return;
    }
    const additions = Array.from(files, (file) => ({
      id: crypto.randomUUID(),
      file,
      kind: kindFor(file.name),
      title: pasted ? `Pasted chart ${++pastedCharts.current}` : file.name.slice(0, 240),
      invalid: !extensions.split(",").some((ext) => file.name.toLowerCase().endsWith(ext))
        ? "Unsupported format. Remove this file or supply a supported original."
        : !file.size || file.size > 20 * 1024 * 1024
          ? "Choose a file between 1 byte and 20 MB."
          : undefined,
    }));
    setRows((list) => [...list, ...additions]);
    onPending(true);
  }
  const pasteChart = useEffectEvent((event: ClipboardEvent) => {
    if (disabled || saving.current || event.defaultPrevented) return;
    const target = event.target;
    if (
      (target instanceof HTMLElement && target.isContentEditable) ||
      (target instanceof Element &&
        target.closest("input, textarea, select, [role=textbox], dialog[open], [role=dialog]"))
    ) {
      return;
    }
    const files = Array.from(event.clipboardData?.files ?? []).flatMap((file) => {
      const extension = clipboardImageExtensions.get(file.type);
      if (!extension) return [];
      const named = /\.(png|jpe?g|webp)$/i.test(file.name);
      return named ? file : new File([file], `clipboard.${extension}`, { type: file.type });
    });
    if (!files.length) return;
    event.preventDefault();
    choose(files, true);
  });
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      pasteChart(event);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  function remove(id: string) {
    const next = rows.filter((row) => row.id !== id);
    setRows(next);
    onPending(next.length > 0);
    setNotice("");
  }
  function edit(
    id: string,
    patch: Partial<Pick<Row, "kind" | "title" | "authorOverride" | "dateOverride">>,
  ) {
    if (disabled || saving.current) return;
    setRows((list) =>
      list.map((row) => (row.id === id && !row.command ? { ...row, ...patch } : row)),
    );
  }
  async function pin() {
    if (saving.current || disabled || !permitted || !rows.length) return;
    saving.current = true;
    onSaving(true);
    let completed = 0;
    try {
      for (const [index, row] of rows.entries()) {
        setProgress(`Pinning ${index + 1} of ${rows.length} · ${row.file.name}`);
        if (row.invalid) continue;
        try {
          let command = row.command;
          if (!command) {
            const artifact = await uploadOriginal(row.file, attribution.rights);
            const media = artifact.media_type;
            const expected =
              row.kind === "image"
                ? media.startsWith("image/")
                : row.kind === "report"
                  ? media === "application/pdf"
                  : media.startsWith("text/");
            if (!expected)
              throw new Error(
                "The content does not match the file format. Choose the original file.",
              );
            command = {
              id: row.id,
              title: row.title.trim() || row.file.name.slice(0, 240),
              kind: row.kind,
              ...attribution,
              author: (row.authorOverride ?? attribution.author ?? "").trim(),
              as_of_date: (row.dateOverride ?? attribution.as_of_date) || null,
              representation: row.kind === "image" ? "chart_screenshot" : "original",
              artifact_id: artifact.id,
            };
            // Retry an unconfirmed POST with the same identity and provenance.
            setRows((list) =>
              list.map((item) => (item.id === row.id ? { ...item, command } : item)),
            );
          }
          const source = await api<EvidenceRecord>("evidence", command);
          if (source.id !== command.id)
            throw new Error("The server returned a different source record.");
          onPin(source);
          completed++;
          setRows((list) => list.filter((item) => item.id !== row.id));
        } catch (cause) {
          const error = cause instanceof Error ? cause.message : "Could not pin this file.";
          setRows((list) => list.map((item) => (item.id === row.id ? { ...item, error } : item)));
        }
      }
      const remaining = rows.length - completed;
      setNotice(
        `${completed} ${completed === 1 ? "file" : "files"} pinned.${remaining ? ` Review ${remaining} remaining below.` : ""}`,
      );
      onPending(remaining > 0);
    } finally {
      saving.current = false;
      onSaving(false);
      setProgress("");
    }
  }
  return (
    <section className={styles.files} aria-label="Upload files">
      <input
        type="file"
        ref={input}
        className="sr-only"
        tabIndex={-1}
        aria-label="Source files"
        accept={extensions}
        multiple
        disabled={disabled}
        onChange={(event) => {
          choose(event.target.files);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        className={styles.drop}
        data-dragging={dragging || undefined}
        disabled={disabled || count + rows.length >= 100}
        onClick={() => input.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          depth.current++;
          setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (--depth.current <= 0) setDragging(false);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          depth.current = 0;
          setDragging(false);
          choose(event.dataTransfer.files);
        }}
      >
        <Upload size={23} strokeWidth={1.5} aria-hidden />
        <span>
          <strong>Drop files or browse</strong>
          <small>Charts, PDFs, text, Markdown, CSV and TSV · up to 20 MB per file</small>
          <small>You can also paste a screenshot while you’re on the desk.</small>
        </span>
      </button>
      {!!rows.length && (
        <div className={styles.queue}>
          <ul aria-label="Files to pin">
            {rows.map((row) => (
              <li key={row.id}>
                <Files size={15} aria-hidden />
                <div>
                  <label className={styles.titleField}>
                    Packet title<span className="sr-only"> for {row.file.name}</span>
                    <input
                      type="text"
                      value={row.title}
                      disabled={disabled || !!row.command}
                      maxLength={240}
                      onChange={(event) => edit(row.id, { title: event.target.value })}
                    />
                  </label>
                  <div className={styles.fileInfo}>
                    <small>
                      {row.title !== row.file.name && `${row.file.name} · `}
                      {(row.file.size / 1024).toLocaleString(undefined, {
                        maximumFractionDigits: 1,
                      })}{" "}
                      KB
                    </small>
                    {canPreviewChart(row) && (
                      <button
                        className="text-link"
                        type="button"
                        aria-haspopup="dialog"
                        aria-label={`Preview queued chart ${row.title.trim() || row.file.name}`}
                        disabled={disabled}
                        onClick={(event) => {
                          previewOpener.current = event.currentTarget;
                          setPreviewId(row.id);
                        }}
                      >
                        Preview chart
                      </button>
                    )}
                  </div>
                  {(row.invalid || row.error) && (
                    <p className="error">{row.invalid || row.error}</p>
                  )}
                  {!row.invalid && (
                    <details className={styles.fileAttribution}>
                      <summary>
                        File attribution<span className="sr-only"> for {row.file.name}</span>
                        {(row.authorOverride !== undefined || row.dateOverride !== undefined) &&
                          " · Edited"}
                      </summary>
                      <fieldset disabled={disabled || !!row.command}>
                        <legend className="sr-only">Attribution for {row.file.name}</legend>
                        <p>
                          {row.command
                            ? "Retry keeps the author and date from this file’s first request."
                            : "Starts with the batch author and date. Clear a field if it’s unknown for this file."}
                        </p>
                        <label>
                          Author / speaker
                          <input
                            type="text"
                            maxLength={240}
                            value={
                              (row.command
                                ? row.command.author
                                : (row.authorOverride ?? attribution.author)) ?? ""
                            }
                            onChange={(event) =>
                              edit(row.id, { authorOverride: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          As-of date
                          <input
                            type="date"
                            value={
                              (row.command
                                ? row.command.as_of_date
                                : (row.dateOverride ?? attribution.as_of_date)) ?? ""
                            }
                            onChange={(event) => edit(row.id, { dateOverride: event.target.value })}
                          />
                        </label>
                        {!row.command &&
                          (row.authorOverride !== undefined || row.dateOverride !== undefined) && (
                            <button
                              className="text-link"
                              type="button"
                              onClick={() =>
                                edit(row.id, { authorOverride: undefined, dateOverride: undefined })
                              }
                            >
                              Use batch author and date
                            </button>
                          )}
                      </fieldset>
                    </details>
                  )}
                </div>
                {(row.kind === "text" || row.kind === "discussion") && (
                  <select
                    aria-label={`Type for ${row.file.name}`}
                    disabled={disabled || !!row.command}
                    value={row.kind}
                    onChange={(event) =>
                      edit(row.id, { kind: event.target.value as "text" | "discussion" })
                    }
                  >
                    <option value="text">Note</option>
                    <option value="discussion">Conversation</option>
                  </select>
                )}
                <button
                  type="button"
                  className={styles.icon}
                  aria-label={`Remove queued ${row.file.name}`}
                  disabled={disabled}
                  onClick={() => remove(row.id)}
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
          <button
            className="button"
            type="button"
            disabled={
              disabled ||
              !permitted ||
              rows.every((row) => !!row.invalid) ||
              count + rows.length > 100
            }
            onClick={() => void pin()}
          >
            {progress
              ? "Pinning files…"
              : `Pin ${rows.length} ${rows.length === 1 ? "file" : "files"}`}
          </button>
          {!permitted && <p className={styles.feedback}>Select usage rights above to pin files.</p>}
        </div>
      )}
      {(progress || notice) && (
        <p className={styles.feedback} role="status">
          {progress || notice}
        </p>
      )}
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreviewId(undefined);
        }}
      >
        <DialogBackdrop className="dialog-backdrop" />
        <DialogContent
          className={styles.chartDialog}
          initialFocus="content"
          finalFocus={() => previewOpener.current}
        >
          {preview && (
            <>
              <header>
                <div>
                  <DialogTitle>{preview.title.trim() || preview.file.name}</DialogTitle>
                  <DialogDescription>
                    Preview from this device. Edit the packet title before pinning.
                  </DialogDescription>
                </div>
                <DialogClose aria-label="Close queued chart preview" className="button icon-button">
                  <X size={18} aria-hidden />
                </DialogClose>
              </header>
              <LocalChart
                key={preview.id}
                file={preview.file}
                title={preview.title.trim() || preview.file.name}
              />
              <footer>
                <label className={styles.queuedChartTitle}>
                  Packet title
                  <input
                    type="text"
                    maxLength={240}
                    value={preview.title}
                    disabled={!!preview.command}
                    onChange={(event) => edit(preview.id, { title: event.target.value })}
                  />
                </label>
                <DialogClose className="button">Done</DialogClose>
              </footer>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
